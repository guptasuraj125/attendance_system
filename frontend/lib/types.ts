export type Status = "PRESENT" | "ABSENT" | "LEAVE" | "WFH" | "ON_DUTY";
export interface Employee { emp_code:string; name:string; email:string; department:string; shift_start:string; shift_end:string; joined_on:string; created_at:number }
export interface Page<T> { items:T[]; total:number; page:number; page_size:number }
export interface Attendance { emp_code:string; date:string; status:Status; punch_in:number|null; punch_out:number|null; work_hours:number|null; late_minutes:number; overtime_minutes:number; half_day:boolean; history:unknown[] }
export interface Monthly { emp_code:string; month:string; working_days:number; present_days:number; leave_days:number; late_count:number; total_late_minutes:number; total_overtime_minutes:number; attendance_pct:number|null }
export interface DepartmentSummary { department:string; headcount:number; present_days:number; avg_work_hours:number|null; late_count:number; total_late_minutes:number; leave_count:number; on_duty_count:number }
export interface Leader { rank:number; emp_code:string; name:string; department:string; total_late_minutes:number; late_count:number }
// The API reports rates as 0–1 ratios; the analytics view converts them for percent display.
export interface Trend { date:string; is_working_day:boolean; headcount:number; present_count:number; late_count:number; attendance_rate:number|null; moving_avg_7d:number|null }
