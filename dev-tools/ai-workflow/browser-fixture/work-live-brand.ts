import type {Brand} from '@/lib/types'
const brand={id:'b0000000-0000-4000-8000-000000000001',companyId:'e0000000-0000-4000-8000-000000000001',slug:'atelier',name:'ATELIER',color:'#c60920',logoUrl:null} as Brand
const brands=[brand],byId=new Map([[brand.id,brand]]),bySlug=new Map([[brand.slug,brand]])
export function useCompanyBrandScope(){return {brands,selectedBrands:brands,brandById:byId,brandBySlug:bySlug,loading:false,error:false}}
