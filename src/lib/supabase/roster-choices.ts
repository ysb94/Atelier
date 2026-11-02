import { getSupabase } from './client'
import { ROSTER_CHOICE_FIELDS, validateRosterChoices, type RosterChoiceKey } from '@/lib/company/roster-choices'
export type RosterChoiceSetting={key:RosterChoiceKey;label:string;options:string[];revision:number}
export async function listRosterChoiceSettings(companyId:string):Promise<{ready:boolean;settings:RosterChoiceSetting[]}> {
  const {data,error}=await getSupabase().from('employee_roster_header_settings').select('header_key,label,choice_options,choice_revision').eq('company_id',companyId).in('header_key',ROSTER_CHOICE_FIELDS.map(field=>field.key))
  if(error){
    console.warn('[roster-choices] 선택 목록 조회 실패',error)
    if(['42703','PGRST204','PGRST205','42P01'].includes(error.code))return {ready:false,settings:[]}
    throw new Error('직원 배치 선택 목록을 불러오지 못했습니다.')
  }
  return {ready:true,settings:(data??[]).map(row=>({key:row.header_key as RosterChoiceKey,label:row.label,options:row.choice_options??[],revision:Number(row.choice_revision)}))}
}
export async function saveRosterChoiceSetting(key:RosterChoiceKey,options:string[],revision:number):Promise<void> {
  const message=validateRosterChoices(key,options)
  if(message)throw new Error(message)
  const {error}=await getSupabase().rpc('save_roster_choice_options',{p_key:key,p_options:options,p_revision:revision})
  if(error){console.warn('[roster-choices] 선택 목록 저장 실패',{key,error});throw new Error(error.code==='40001'?'다른 곳에서 목록을 변경했습니다. 서버 값을 확인한 뒤 다시 저장해 주세요.':error.message)}
}
