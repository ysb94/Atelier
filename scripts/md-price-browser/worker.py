"""Private JSON-lines worker owned by Vite. No listening socket, account cookies or API keys."""
import asyncio
import ipaddress
import json
import re
import socket
import sys
import time
from urllib.parse import urlparse

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

HOSTS = ('musinsa.com', '29cm.co.kr', 'kyobobook.co.kr', 'babosarang.co.kr',
         'seoulstore.com', 'naver.com', 'masmarulez.com', 'masmarulez001.cafe24.com',
         'gift.kakao.com', 'artbox.co.kr', 'a-bly.com', 'ohou.se', 'zigzag.kr',
         '10x10.co.kr', 'gmarket.co.kr', 'gvg.co.kr', 'hago.kr', 'wconcept.co.kr',
         'yes24.com', 'ssg.com', 'eqlstore.com', '11st.co.kr', 'wemakeprice.com',
         'kream.co.kr', 'lotteimall.com', 'hyundaihmall.com', 'tmon.co.kr')


def shop(raw):
    u = urlparse(raw)
    if u.scheme not in ('http', 'https') or u.username or u.password or u.port not in (None, 80, 443):
        raise ValueError('허용하지 않은 상품 주소입니다.')
    domain = next((h for h in HOSTS if u.hostname == h or (u.hostname or '').endswith('.' + h)), None)
    return 'masmarulez.com' if domain == 'masmarulez001.cafe24.com' else domain


# Read the rendered product panel, not hidden HTML, review prices or recommendation cards.
# These selectors locate a region only; the worker never decides the price or performs purchases.
SNAPSHOT = r"""() => {
  const visible = e => e && e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const host = location.hostname;
  let root, scope = 'generic';
  if (host.endsWith('musinsa.com')) {
    root = [...document.querySelectorAll('[class*="FixedArea__Container"]')].find(visible);
    scope = 'musinsa-product-panel';
  } else if (host.endsWith('29cm.co.kr')) {
    root = document.querySelector('#pdp_product_name');
    while (root && root.tagName !== 'MAIN' && !root.querySelector('form')) root = root.parentElement;
    scope = '29cm-product-panel';
  } else if (host === 'masmarulez001.cafe24.com' || host.endsWith('masmarulez.com')) {
    root = [...document.querySelectorAll('.infoArea_content')].find(visible);
    scope = 'cafe24-product-panel';
  } else if (host === 'ssg.com' || host.endsWith('.ssg.com')) {
    root = [...document.querySelectorAll('.cdtl_col_rgt')].find(e=>visible(e)&&e.querySelector('.cdtl_info_tit_txt'));
    scope = 'ssg-product-panel';
    // A changed layout must not turn recommendation prices into the main product price.
    if (!root) return {visibleText:'',scope:'ssg-panel-missing',controls:[],title:document.title};
  }
  if (!root) { root = document.querySelector('main') || document.body; scope = 'generic'; }
  const skip = 'script,style,svg,noscript,iframe,nav,footer,[hidden],[aria-hidden="true"],'+
    '[class*="Recommend"],[class*="recommend"],[class*="Review"],[class*="review"]';
  // innerText on hidden nodes falls back to textContent: prune by computed visibility explicitly.
  const read = el => {
    if ((getComputedStyle(el).display!=='contents' && !visible(el)) || el.matches(skip)) return '';
    const parts=[];
    for (const node of el.childNodes) {
      if (node.nodeType===Node.TEXT_NODE) parts.push(node.textContent);
      else if (node.nodeType===Node.ELEMENT_NODE) {
        const block=!['inline','contents'].includes(getComputedStyle(node).display);
        parts.push((block?'\n':'')+read(node)+(block?'\n':''));
      }
    }
    return parts.join('');
  };
  const text=read(root).replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,22000);
  const controls=[...root.querySelectorAll('button,a,[role="button"]')].filter(e=>visible(e)&&!e.closest(skip))
    .map(e=>({text:(e.innerText||e.getAttribute('aria-label')||'').trim(),disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true'}))
    .filter(e=>/^(바로\s*)?구매(하기)?$|장바구니|품절|판매\s*(종료|중지)|회원\s*전용/.test(e.text) && e.text.length<100);
  return {visibleText:text,scope,controls,title:document.title};
}"""


class Collector:
    def __init__(self, browser, visible_browser_factory=None):
        self.browser = browser
        self.visible_browser_factory = visible_browser_factory
        self.slots = asyncio.Semaphore(2)
        self.dns = {}

    async def public_host(self, host):
        if not host or host.lower() == 'localhost' or host.endswith(('.localhost', '.local')):
            return False
        if host not in self.dns:
            try:
                addresses = await asyncio.to_thread(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM)
                self.dns[host] = bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)
            except OSError as error:
                print(json.dumps({'event':'dns-failed','host':host,'type':type(error).__name__}),file=sys.stderr,flush=True)
                self.dns[host] = False  # The request is blocked; no unvalidated DNS fallback.
        return self.dns[host]

    async def collect(self, raw, diagnostic):
        domain = shop(raw)
        if not domain:
            raise ValueError('아직 수집을 허용하지 않은 쇼핑몰입니다.')
        async with self.slots:
            started = time.monotonic()
            # SSG returned 403 in headless mode but loaded the same product in a visible
            # browser with otherwise identical settings. No automatic retry or account state.
            visible_mode = domain == 'ssg.com' and self.visible_browser_factory is not None
            browser = await self.visible_browser_factory() if visible_mode else self.browser
            context = await browser.new_context(locale='ko-KR', timezone_id='Asia/Seoul',
                viewport={'width':1365, 'height':1000}, service_workers='block', accept_downloads=False)
            page = await context.new_page()
            page.set_default_timeout(12000)

            async def route_request(route):
                request = route.request
                url = urlparse(request.url)
                if url.scheme not in ('http', 'https') or url.port not in (None, 80, 443):
                    return await route.abort()
                if request.resource_type in ('image', 'media', 'font'):
                    return await route.abort()
                if request.is_navigation_request() and request.frame == page.main_frame:
                    try:
                        if shop(request.url) != domain:
                            return await route.abort()
                    except ValueError:
                        return await route.abort()  # Invalid navigation is deliberately rejected.
                if not await self.public_host(url.hostname):
                    return await route.abort()
                await route.continue_()

            await context.route('**/*', route_request)
            try:
                response = await page.goto(raw, wait_until='domcontentloaded', timeout=25000)
                status = response.status if response else 0
                if status in (401,403,404,410,429):
                    text = (await page.locator('body').inner_text())[:4000]
                    snapshot = {'visibleText':text,'title':await page.title(),'scope':'error','controls':[]}
                else:
                    # Hydration may change the price and add purchase controls after the first paint.
                    # Wait for a stable product panel, never for the navbar's cart link.
                    last, stable, snapshot = '', 0, {}
                    deadline = time.monotonic() + 12
                    while time.monotonic() < deadline:
                        snapshot = await page.evaluate(SNAPSHOT)
                        text = snapshot['visibleText']
                        if snapshot['scope']=='generic' and urlparse(page.url).path in ('','/'):
                            break  # Product redirected to a storefront; never read recommendation prices.
                        stable = stable + 1 if text == last else 0
                        last = text
                        ready = snapshot['scope'] != 'generic' and snapshot['controls'] and re.search(r'\d[\d,]*\s*원|품절|판매\s*(종료|중지)', text)
                        if ready and stable >= 2:
                            break
                        if re.search(r'access denied|captcha|접근이?\s*제한|서비스 접속이 불가', text, re.I):
                            break
                        await asyncio.sleep(0.5)
                blocked = bool(re.search(r'access denied|captcha|접근이?\s*제한|서비스 접속이 불가|비정상적인 접근', snapshot['title']+' '+snapshot['visibleText'][:1500], re.I))
                # Preserve the page's words; controls provide separate provenance, not invented page text.
                snapshot.update(url=page.url,status=status,blocked=blocked,crawlMs=round((time.monotonic()-started)*1000))
                print(json.dumps({'event':'collected','host':domain,'browserMode':'visible' if visible_mode else 'headless','ms':snapshot['crawlMs'],'chars':len(snapshot['visibleText']),**diagnostic},ensure_ascii=False),file=sys.stderr,flush=True)
                return snapshot
            finally:
                await context.close()


async def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        visible_browser = None
        visible_launch_lock = asyncio.Lock()

        async def get_visible_browser():
            nonlocal visible_browser
            async with visible_launch_lock:
                if visible_browser is None or not visible_browser.is_connected():
                    visible_browser = await p.chromium.launch(headless=False)
                return visible_browser

        collector = Collector(browser, visible_browser_factory=get_visible_browser)
        jobs = set()

        async def run(message):
            try:
                data = await asyncio.wait_for(collector.collect(message['url'],message.get('context',{})),timeout=55)
                result = {'id':message['id'],'data':data}
            except Exception as error:
                print(json.dumps({'event':'failed','type':type(error).__name__,**message.get('context',{})},ensure_ascii=False),file=sys.stderr,flush=True)
                detail = '상품 화면 로딩 제한 시간 초과' if isinstance(error,(TimeoutError,PlaywrightTimeout)) else '상품 화면을 열지 못했습니다. 접속 상태를 확인해 주세요.'
                # Network/timeout failures are observations too: do not leave a past successful price
                # looking current after a failed refresh. Setup/process failures still fail the request.
                result = {'id':message.get('id'),'data':{'url':message.get('url',''),'status':0,'visibleText':detail,'title':'','blocked':False,'crawlMs':0,'scope':'error','controls':[]}}
            print(json.dumps(result,ensure_ascii=False),flush=True)

        try:
            while True:
                line = await asyncio.to_thread(sys.stdin.readline)
                if not line:
                    break
                try:
                    message = json.loads(line)
                    if len(jobs) >= 6:
                        print(json.dumps({'id':message.get('id'),'error':'수집 요청이 많습니다. 잠시 후 다시 시도해 주세요.'},ensure_ascii=False),flush=True)
                        continue
                    task = asyncio.create_task(run(message))
                    jobs.add(task)
                    task.add_done_callback(jobs.discard)
                except (ValueError,TypeError) as error:
                    print(f'[md-price] 잘못된 작업 메시지: {type(error).__name__}',file=sys.stderr,flush=True)
        finally:
            if jobs:
                await asyncio.gather(*jobs)
            if visible_browser is not None and visible_browser.is_connected():
                await visible_browser.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
