/// <reference types="node" />

import assert from 'node:assert/strict'
import {
  chartGroupSeriesId,
  groupPartnersForOutboundChart,
  parsePartnerChartLabel,
  UNFILED_CHART_FOLDER_KEY,
} from './partner-outbound-chart'

assert.deepEqual(parsePartnerChartLabel('교보문고 · 울산점'), {
  group: '교보문고',
  site: '울산점',
})
assert.deepEqual(parsePartnerChartLabel('에이랜드'), {
  group: '에이랜드',
  site: '에이랜드',
})

const grouped = groupPartnersForOutboundChart(
  [
    {
      partnerId: 'p-ulsan',
      partnerName: '교보문고 · 울산점',
      quantity: 40,
      shipmentCount: 2,
      lastShippedOn: '2026-09-01',
    },
    {
      partnerId: 'p-daegu',
      partnerName: '교보문고 · 대구점',
      quantity: 3,
      shipmentCount: 1,
      lastShippedOn: '2026-09-02',
    },
    {
      partnerId: 'p-hongdae',
      partnerName: '에이랜드 · 홍대점',
      quantity: 12,
      shipmentCount: 1,
      lastShippedOn: '2026-09-03',
    },
  ],
  [
    {
      id: 'p-ulsan',
      groupId: 'g-kyobo',
      groupName: '교보문고',
      siteName: '울산점',
      folderId: 'f-offline-store',
    },
    {
      id: 'p-daegu',
      groupId: 'g-kyobo',
      groupName: '교보문고',
      siteName: '대구점',
      folderId: 'f-offline-store',
    },
    {
      id: 'p-hongdae',
      groupId: 'g-aland',
      groupName: '에이랜드',
      siteName: '홍대점',
      folderId: 'f-offline-store',
    },
  ],
  [
    {
      id: 'f-offline',
      brandId: 'b',
      parentId: null,
      name: '오프라인',
      normalizedName: '오프라인',
      order: 0,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'f-offline-store',
      brandId: 'b',
      parentId: 'f-offline',
      name: '매장',
      normalizedName: '매장',
      order: 0,
      createdAt: '',
      updatedAt: '',
    },
  ],
)

assert.equal(grouped.folders.length, 1)
assert.equal(grouped.folders[0]?.key, 'f-offline')
assert.equal(grouped.folders[0]?.label, '오프라인')
assert.equal(grouped.folders[0]?.quantity, 55)
assert.equal(grouped.companies.length, 2)
assert.equal(grouped.companies[0]?.label, '교보문고')
assert.equal(grouped.companies[0]?.quantity, 43)
assert.equal(grouped.companies[0]?.units.length, 2)
assert.equal(grouped.companies[0]?.units[0]?.siteLabel, '울산점')
assert.equal(grouped.companies[1]?.label, '에이랜드')
assert.equal(chartGroupSeriesId('g-kyobo'), '__group__:g-kyobo')

const unfiled = groupPartnersForOutboundChart(
  [
    {
      partnerId: 'p-1',
      partnerName: '바인드 · 제주점',
      quantity: 1,
      shipmentCount: 1,
      lastShippedOn: '2026-09-01',
    },
  ],
  [],
  [],
)
assert.equal(unfiled.folders[0]?.key, UNFILED_CHART_FOLDER_KEY)
assert.equal(unfiled.companies[0]?.label, '바인드')
assert.equal(unfiled.companies[0]?.units[0]?.siteLabel, '제주점')

const sameQuantitySites = groupPartnersForOutboundChart(
  [
    {
      partnerId: 'p-eulji',
      partnerName: '교보문고 · 을지점',
      quantity: 10,
      shipmentCount: 1,
      lastShippedOn: '2026-09-01',
    },
    {
      partnerId: 'p-gangnam',
      partnerName: '교보문고 · 강남점',
      quantity: 10,
      shipmentCount: 1,
      lastShippedOn: '2026-09-01',
    },
  ],
  [
    {
      id: 'p-eulji',
      groupId: 'g-kyobo',
      groupName: '교보문고',
      siteName: '을지점',
      folderId: null,
    },
    {
      id: 'p-gangnam',
      groupId: 'g-kyobo',
      groupName: '교보문고',
      siteName: '강남점',
      folderId: null,
    },
  ],
)
assert.deepEqual(
  sameQuantitySites.companies[0]?.units.map((unit) => unit.siteLabel),
  ['강남점', '을지점'],
)

console.log('partner-outbound-chart.verify ok')
