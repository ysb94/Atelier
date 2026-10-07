"""Offline rendered-DOM regressions. Uses synthetic pages, never contacts shopping sites."""
import asyncio
from unittest.mock import patch
from playwright.async_api import async_playwright
from worker import Collector, SNAPSHOT, shop


async def main():
    assert shop('https://www.29cm.co.kr/products/1') == '29cm.co.kr'
    assert shop('https://musinsa.com.evil.example/products/1') is None
    for url in ('file:///etc/passwd','http://user:secret@musinsa.com/','http://musinsa.com:5173/'):
        try:
            shop(url)
            raise AssertionError('Unsafe URL accepted')
        except ValueError:
            pass  # Expected validation rejection, not an ignored runtime failure.
    collector=Collector(None)
    assert not await collector.public_host('localhost')
    assert not await collector.public_host('127.0.0.1')
    assert not await collector.public_host('169.254.169.254')
    with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('192.168.1.1',443))]):
        assert not await collector.public_host('rebound.example')
    async with async_playwright() as p:
        browser=await p.chromium.launch()
        page=await browser.new_page()
        async def snapshot(host,html):
            await page.route('**/*',lambda route:route.fulfill(content_type='text/html; charset=utf-8',body='<meta charset="utf-8">'+html))
            await page.goto('https://'+host+'/products/1')
            result=await page.evaluate(SNAPSHOT)
            await page.unroute('**/*')
            return result
        data=await snapshot('www.29cm.co.kr','''<main><div><div style="display:contents"><h2 id="pdp_product_name">Bag Black</h2></div><p>판매가 24,850원</p><form><button id="pdp_buy_now">바로 구매하기</button></form></div><div>다른 상품 100원</div></main>''')
        assert 'Bag Black' in data['visibleText'] and '24,850원' in data['visibleText']
        assert '다른 상품' not in data['visibleText']
        assert data['controls']==[{'text':'바로 구매하기','disabled':False}]
        data=await snapshot('masmarulez001.cafe24.com','''<nav><button>장바구니</button></nav><div class="infoArea_content"><h1>Bag Black</h1><span>22,000원</span><div style="display:none">품절 1,000원</div><span hidden>판매 중지</span><div class="review">다른 상품 100원</div><button disabled>구매하기</button></div>''')
        assert '품절' not in data['visibleText'] and '판매 중지' not in data['visibleText'] and '100원' not in data['visibleText']
        assert data['controls']==[{'text':'구매하기','disabled':True}]
        data=await snapshot('www.musinsa.com','''<main><div>추천 상품 500원</div><div class="FixedArea__Container-123"><h2>Bag Black</h2><div style="display:contents">46,900원</div><button>장바구니</button><button>회원 전용</button></div></main>''')
        assert '추천 상품' not in data['visibleText'] and '46,900원' in data['visibleText']
        assert data['scope']=='musinsa-product-panel'
        data=await snapshot('www.ssg.com','''<nav><button>장바구니</button></nav><div class="cdtl_col_rgt"><h2 class="cdtl_info_tit_txt">Tiny drop heart keyring</h2><p>쿠폰할인 최적가 17,595원</p><p>판매가 19,550원</p><p>카드혜택가 16,364원</p><button>장바구니</button><button>바로구매</button><div class="recommend"><span>추천 상품 100원</span><button>장바구니 담기</button></div></div><div>다른 상품 200원<button>장바구니 담기</button></div>''')
        assert data['scope']=='ssg-product-panel' and 'Tiny drop heart keyring' in data['visibleText']
        assert all(price in data['visibleText'] for price in ('17,595원','19,550원','16,364원'))
        assert '100원' not in data['visibleText'] and '200원' not in data['visibleText']
        assert data['controls']==[{'text':'장바구니','disabled':False},{'text':'바로구매','disabled':False}]
        data=await snapshot('www.ssg.com','''<main><h2>추천 상품</h2><p>100원</p><button>장바구니</button></main>''')
        assert data['scope']=='ssg-panel-missing' and not data['visibleText'] and not data['controls']
        data=await snapshot('www.ssg.com','''<div class="cdtl_col_rgt"><h2 class="cdtl_info_tit_txt">Sold out bag</h2><p>품절</p><button disabled>구매하기</button></div><div class="recommend"><p>다른 상품 100원</p><button>장바구니</button></div>''')
        assert data['controls']==[{'text':'구매하기','disabled':True}] and '품절' in data['visibleText']
        await browser.close()
    print('PASS: rendered product scope, display:contents, hidden sold-out/recommendations, disabled controls and network boundaries')


asyncio.run(main())
