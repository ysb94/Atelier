import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyMeetingNoticeContext(db, actor, users) {
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261126062000_meeting_notice_context.sql', 'utf8'))
  const query = 'select public.list_my_meeting_notice_context() as result'
  const previous = 'select public.list_my_meeting_invitations(), public.list_company_meetings()'
  const byId = (a,b) => a.id.localeCompare(b.id)
  const results = []
  for (const [role, id] of Object.entries(users)) {
    await actor(id)
    const { series, invitations, now } = (await db.query(`select public.list_company_meetings() as series,
      public.list_my_meeting_invitations() as invitations, date_trunc('minute',now()) as now`)).rows[0]
    const context = (await db.query(query)).rows[0].result
    assert.deepEqual(context.invitations, invitations, role + ' preserves all notice versions and read state')
    const notices = invitations.map(item => ({ direct: item.kind === 'meeting_invitation' && item.meeting?.role !== 'host',
      params: new URL(item.href,'https://atelier.local').searchParams }))
    const expected = series.filter(s => notices.some(n => n.params.get('meeting') === s.id)).map(s => ({
      id:s.id, status:s.status, rounds:s.rounds.filter(r => notices.some(n => n.direct && n.params.get('meeting') === s.id && n.params.get('round') === r.id))
        .map(r => ({id:r.id,scheduleVersion:r.scheduleVersion,response:r.responses.find(p => p.profileId === id)?.status ?? 'pending',finalized:Boolean(r.manualConfirmation)}))
    })).sort(byId)
    assert.deepEqual(context.series, expected, role + ' preserves exact member response and current series flags')
    const starts = []
    for (const s of series) for (const r of s.rounds) {
      if (s.phase !== 'published' || s.status !== 'in_progress' || !r.confirmed || !r.startsAt) continue
      if (Date.parse(r.startsAt+':00+09:00') < new Date(now).getTime()) continue
      if (s.host.id !== id && !r.membership.some(p => p.person.id === id && p.role === 'attendee')) continue
      if (r.manualConfirmation?.excludedIds.includes(id)) continue
      starts.push({ seriesId:s.id,roundId:r.id,title:s.title,round:r.round,role:s.host.id===id?'호스트':'멤버',
        startsAt:r.startsAt,roomId:r.roomId,durationMinutes:r.durationMinutes??s.durationMinutes,scheduleVersion:r.scheduleVersion })
    }
    starts.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.roundId.localeCompare(b.roundId))
    assert.deepEqual(context.starts, starts, role + ' same upcoming confirmed schedules')
    if (['host','member','uninvolved'].includes(role)) {
      const before = [], after = []
      for (let i=0; i<6; i++) {
        const pair = [[previous,before],[query,after]]
        for (const [sql,samples] of i % 2 ? pair : pair.reverse()) {
          const plan = await db.query('explain (analyze,format json,timing off) ' + sql)
          if (i > 0) samples.push(plan.rows[0]['QUERY PLAN'][0]['Execution Time'])
        }
      }
      const median = samples => samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)]
      results.push({role,beforeBytes:Buffer.byteLength(JSON.stringify([series,invitations])),afterBytes:Buffer.byteLength(JSON.stringify(context)),
        previousMedianMs:median(before), contextMedianMs:median(after)})
    }
  }
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon")
  await assert.rejects(() => db.query(query), e => e.code === '42501')
  await db.exec('reset role')
  console.log('meeting-notice-context: all role projections match, response bytes', JSON.stringify(results))
}
