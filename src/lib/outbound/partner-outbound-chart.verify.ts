/// <reference types="node" />

import assert from 'node:assert/strict'
import {
  bucketTotalsByPeriod,
  chartGroupSeriesId,
  companySeriesId,
  groupPartnersForOutboundChart,
  limitCompaniesWithOther,
  niceTicks,
  OTHER_COMPANY_KEY,
  parsePartnerChartLabel,
  resolveChartSeries,
  siteSeriesId,
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

assert.deepEqual(
  bucketTotalsByPeriod(
    [
      { shippedOn: '2026-09-20', quantity: 2 },
      { shippedOn: '2026-09-21', quantity: 5 },
      { shippedOn: '2026-09-23', quantity: 1 },
    ],
    ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'],
    'day',
  ),
  [
    { key: '2026-09-20', quantity: 2 },
    { key: '2026-09-21', quantity: 5 },
    { key: '2026-09-22', quantity: 0 },
    { key: '2026-09-23', quantity: 1 },
  ],
)

assert.deepEqual(
  bucketTotalsByPeriod(
    [
      { shippedOn: '2026-09-20', quantity: 2 },
      { shippedOn: '2026-09-21', quantity: 5 },
      { shippedOn: '2026-09-23', quantity: 1 },
    ],
    ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'],
    'week',
  ),
  [
    { key: '2026-09-14', quantity: 2 },
    { key: '2026-09-21', quantity: 6 },
  ],
)

const rankedCompanies = [
  { key: 'a', label: 'A', quantity: 10, folderKey: 'f', folderLabel: '폴더', units: [] },
  { key: 'b', label: 'B', quantity: 9, folderKey: 'f', folderLabel: '폴더', units: [] },
  { key: 'c', label: 'C', quantity: 8, folderKey: 'f', folderLabel: '폴더', units: [] },
  { key: 'd', label: 'D', quantity: 1, folderKey: 'f', folderLabel: '폴더', units: [] },
]
assert.equal(limitCompaniesWithOther(rankedCompanies, 4).length, 4)
assert.equal(limitCompaniesWithOther(rankedCompanies, 3)[3]?.key, 'd')
const limited = limitCompaniesWithOther(rankedCompanies, 2)
assert.equal(limited.length, 3)
assert.equal(limited[2]?.key, OTHER_COMPANY_KEY)
assert.equal(limited[2]?.label, '기타')
assert.equal(limited[2]?.quantity, 9)
assert.deepEqual(
  limited[2]?.units.map((unit) => unit.siteLabel),
  ['C', 'D'],
)
assert.deepEqual(
  limited[2]?.members?.map((company) => company.key),
  ['c', 'd'],
)

assert.deepEqual(
  bucketTotalsByPeriod(
    [
      { shippedOn: '2026-09-21', quantity: Number.NaN },
      { shippedOn: '2026-09-21', quantity: 4 },
    ],
    ['2026-09-21'],
    'day',
  ),
  [{ key: '2026-09-21', quantity: 4 }],
)

assert.deepEqual(niceTicks(378, 4), [0, 100, 200, 300, 400])
assert.deepEqual(niceTicks(0, 4), [0])

const kyobo = {
  key: 'g-kyobo',
  label: '교보문고',
  quantity: 15,
  folderKey: 'f',
  folderLabel: '오프라인',
  units: [
    { partnerId: 'p-ulsan', partnerName: '교보문고 · 울산점', siteLabel: '울산점', quantity: 10 },
    { partnerId: 'p-gangnam', partnerName: '교보문고 · 강남점', siteLabel: '강남점', quantity: 5 },
  ],
}
const musinsa = {
  key: 'g-musinsa',
  label: '무신사',
  quantity: 3,
  folderKey: 'f',
  folderLabel: '온라인',
  units: [
    { partnerId: 'p-musinsa', partnerName: '무신사', siteLabel: '무신사', quantity: 3 },
  ],
}
const scope = { companies: [kyobo, musinsa], other: limited[2] }
assert.deepEqual(resolveChartSeries(companySeriesId('g-kyobo'), scope), {
  id: 'company:g-kyobo',
  label: '교보문고',
  partnerIds: ['p-ulsan', 'p-gangnam'],
  quantity: 15,
})
assert.deepEqual(resolveChartSeries(siteSeriesId('p-ulsan'), scope), {
  id: 'site:p-ulsan',
  label: '교보문고 · 울산점',
  partnerIds: ['p-ulsan'],
  quantity: 10,
})
assert.deepEqual(resolveChartSeries(siteSeriesId('p-musinsa'), scope)?.label, '무신사')
assert.equal(
  resolveChartSeries(companySeriesId(OTHER_COMPANY_KEY), { companies: [kyobo], other: limited[2] })
    ?.quantity,
  9,
)
assert.equal(resolveChartSeries('company:missing', scope), null)
assert.equal(resolveChartSeries(companySeriesId(OTHER_COMPANY_KEY), { companies: [kyobo] }), null)

console.log('partner-outbound-chart.verify ok')
