export const ROSTER_CHOICE_FIELDS = [
  {key:'bankName',label:'은행명',max:40},
  {key:'workplace',label:'근무지',max:80},
  {key:'employmentType',label:'근로형태',max:40},
  {key:'gender',label:'성별',max:10},
  {key:'workDays',label:'근로일',max:80},
  {key:'workHours',label:'근로시간',max:80},
  {key:'breakTime',label:'휴게시간',max:80},
  {key:'payBasis',label:'연봉기준',max:40},
] as const
export type RosterChoiceKey = typeof ROSTER_CHOICE_FIELDS[number]['key']
export function isRosterChoiceKey(key:string):key is RosterChoiceKey {
  return ROSTER_CHOICE_FIELDS.some(field=>field.key===key)
}
export function validateRosterChoices(key:RosterChoiceKey,options:readonly string[]):string|null {
  const max=ROSTER_CHOICE_FIELDS.find(field=>field.key===key)!.max
  if(options.length>100)return '선택 항목은 최대 100개까지 등록할 수 있습니다.'
  if(options.some(value=>!value.trim()||value!==value.trim()||[...value].length>max))return `각 항목은 앞뒤 공백 없이 1~${max}자로 입력해 주세요.`
  if(new Set(options).size!==options.length)return '중복된 선택 항목이 있습니다.'
  return null
}
/** Removing an option never clears the value already assigned to an employee. */
export function rosterChoiceValues(options:readonly string[],current:string):string[] {
  return current&&!options.includes(current)?[current,...options]:[...options]
}
