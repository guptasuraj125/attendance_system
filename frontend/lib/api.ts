import type { Attendance, DepartmentSummary, Employee, Leader, Monthly, Page, Status, Trend } from "./types";
const BASE="/backend";
export class ApiError extends Error { constructor(public status:number,message:string){super(message)} }
async function request<T>(path:string,init?:RequestInit):Promise<T>{
  let response:Response;
  try { response=await fetch(`${BASE}${path}`,{...init,headers:{...(init?.body?{"Content-Type":"application/json"}:{}),...init?.headers},cache:"no-store"}); }
  catch { throw new ApiError(0,"Unable to connect to the API."); }
  let data:unknown; try { data=await response.json(); } catch { data=null; }
  if(!response.ok){const body=data as {detail?:unknown}|null; const detail=typeof body?.detail==="string"?body.detail:""; const safe=detail&&!/mongo|database|traceback|exception|\.py|password|secret|uri/i.test(detail)?detail:""; const standard:Record<number,string>={404:"Resource not found.",409:"This request conflicts with the current record state.",422:"Please check the submitted values.",503:"The service or database is temporarily unavailable."}; throw new ApiError(response.status,safe||standard[response.status]||"The request could not be completed."); }
  return data as T;
}
const qs=(values:Record<string,string|number|undefined>)=>{const p=new URLSearchParams(); for(const [k,v] of Object.entries(values))if(v!==undefined&&v!=="")p.set(k,String(v));return p.toString()};
export const api={
 employees:(page=1,page_size=20,department?:string)=>request<Page<Employee>>(`/employees?${qs({page,page_size,department})}`),
 createEmployee:(body:Omit<Employee,"created_at">)=>request<Employee>("/employees",{method:"POST",body:JSON.stringify(body)}),
 removeEmployee:(emp_code:string)=>request<{emp_code:string;removed:boolean;removed_at:number}>(`/employees/${encodeURIComponent(emp_code)}`,{method:"DELETE"}),
 attendance:(params:{page?:number;page_size?:number;emp_code?:string;date_from?:string;date_to?:string;status?:Status})=>request<Page<Attendance>>(`/attendance?${qs(params)}`),
 punchIn:(emp_code:string,status:Status)=>request<Attendance>("/attendance/punch-in",{method:"POST",body:JSON.stringify({emp_code,status})}),
 punchOut:(emp_code:string)=>request<Attendance>("/attendance/punch-out",{method:"POST",body:JSON.stringify({emp_code})}),
 monthly:(code:string,month:string)=>request<Monthly>(`/analytics/employees/${encodeURIComponent(code)}/monthly?${qs({month})}`),
 summary:(month:string,department?:string)=>request<{month:string;items:DepartmentSummary[]}>(`/analytics/departments/summary?${qs({month,department})}`),
 leaderboard:(month:string,limit=10,department?:string)=>request<{month:string;items:Leader[]}>(`/analytics/leaderboard/late?${qs({month,limit,department})}`),
 trend:(department:string,from:string,to:string)=>request<{department:string;items:Trend[]}>(`/analytics/departments/${encodeURIComponent(department)}/trend?${qs({from,to})}`)
};
