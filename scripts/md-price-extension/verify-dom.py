"""Synthetic DOM verification only; all browser requests are intercepted locally."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    script = Path(__file__).with_name('read-product.js').read_text(encoding='utf-8')
    script = script[script.index('export function'):].replace('export function', 'function', 1)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        async def capture(html, url='https://smartstore.naver.com/masmarulez/products/13243466853'):
            await page.route('**/*', lambda route: route.fulfill(content_type='text/html; charset=utf-8', body='<meta charset="utf-8"><title>Tiny drop heart keyring : 마스마룰즈</title>'+html))
            await page.goto(url)
            value = await page.evaluate('('+script+')')
            await page.unroute('**/*')
            return value

        value = await capture('<header>계정 정보</header><main><section><h3>Tiny drop heart keyring</h3><p>판매가 <span>22,000</span>원</p><button>장바구니</button><input value="private"><div hidden>품절 100원</div><div class="review">사용자 리뷰 500원</div><div class="recommend"><p>추천 상품 300원</p><button>구매하기</button></div></section><section>다른 상품 200원<button>구매하기</button></section></main>')
        assert value['pageName'] == 'Tiny drop heart keyring'
        assert '22,000' in value['visibleText']
        assert all(text not in value['visibleText'] for text in ('계정 정보','private','100원','500원','300원','200원'))
        assert value['controls'] == [{'text':'장바구니','disabled':False}]
        assert value['httpStatus'] == 200
        assert 'error' in await capture('<main><h1>추천 상품</h1><p>100원</p><button>구매하기</button></main>')
        assert 'error' in await capture('<main><h3>Tiny drop heart keyring</h3><p>22,000원</p></main><nav><button>장바구니</button></nav>')
        assert 'error' in await capture('<main><h3>Tiny drop heart keyring</h3><p>22,000원</p><button>구매</button></main>', 'https://smartstore.naver.com/other/products/13243466853')
        value = await capture('<main><h3>Tiny drop heart keyring</h3><p>품절</p><button disabled>구매하기</button></main>')
        assert value['controls'] == [{'text':'구매하기','disabled':True}]
        await browser.close()
    print('PASS: extension rendered product scope, missing panel, recommendations/hidden inputs exclusion and sold-out controls')


asyncio.run(main())
