import assert from 'node:assert/strict'
import { isRosterChoiceKey, rosterChoiceValues, validateRosterChoices } from './roster-choices'
assert.equal(isRosterChoiceKey('bankName'),true)
assert.equal(isRosterChoiceKey('residentId'),false)
assert.deepEqual(rosterChoiceValues(['은행 B','은행 A'],'예전 은행'),['예전 은행','은행 B','은행 A'])
assert.deepEqual(rosterChoiceValues(['은행 A'],'은행 A'),['은행 A'])
assert.deepEqual(rosterChoiceValues([],'기존값'),['기존값'])
assert.deepEqual(rosterChoiceValues(['사무실'],''),['사무실'])
assert.equal(validateRosterChoices('bankName',[]),null)
assert.ok(validateRosterChoices('bankName',['은행','은행']))
assert.ok(validateRosterChoices('gender',['12345678901']))
assert.ok(validateRosterChoices('workplace',[' 공백']))
assert.equal(validateRosterChoices('workplace',['본사','물류 사무실']),null)
console.info('Roster choices: original values, ordering, supported headers and validation passed')
