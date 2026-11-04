import assert from 'node:assert/strict'
import { holidayAmount, holidayClock, holidayCredit, parsedHolidayIntervals } from './holiday-work.ts'
const periods = [{start:540,end:720},{start:780,end:1080}]
assert.deepEqual(holidayAmount(periods,'rest'),{minutes:480,night:0,units:1440})
assert.deepEqual(holidayAmount([{start:540,end:1140}],'holiday'),{minutes:600,night:0,units:1920})
assert.equal(holidayAmount([{start:0,end:360},{start:1320,end:1440}],'holiday')?.units,1920)
assert.equal(holidayAmount([{start:540,end:541}],'rest')?.units,3)
assert.equal(holidayCredit(3),'1분 30초')
assert.equal(holidayAmount([{start:540,end:600},{start:599,end:660}],'holiday'),null)
assert.equal(holidayAmount([{start:1380,end:1500}],'holiday'),null,'midnight must be split into each date')
assert.equal(holidayAmount([{start:541.5,end:600}],'rest'),null)
assert.equal(holidayClock('24:00'),1440);assert.equal(holidayClock('24:01'),null)
assert.equal(parsedHolidayIntervals([{start:'09:00',end:''}]),null)
assert.deepEqual(parsedHolidayIntervals([{start:'09:00',end:'12:00'}]),[{start:540,end:720}])
console.log('holiday-work calculation: rest/holiday bands, breaks, night, minute precision and validation passed')
