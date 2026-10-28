-- Test-only schema shapes, no production staff or business records.
create role anon; create role authenticated; create schema auth; create schema app; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,app,auth,storage to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;
create table public.ai_item_name_recommendation_feedback ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"user_id" uuid,"rule_id" uuid,"cache_id" uuid,"item_name" text,"normalized_item_name" text,"main_style_id" uuid,"product_lookup_key" text,"normalized_product_lookup_key" text,"scope" text,"action" text,"suggested_action" text,"source" text,"outcome" text,"provider" text,"model_id" text,"invalidated_at" timestamp with time zone default now(),"created_at" timestamp with time zone default now());
create table public.ai_item_name_recommendation_feedback_components ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"feedback_id" uuid,"style_id" uuid,"quantity" integer,"kind" text,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.ai_recommendation_cache ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"feature_key" text,"cache_key" text,"provider" text,"model_id" text,"policy" text,"lookup_keys" jsonb,"candidates" jsonb,"recommendation" jsonb,"source" text,"input_tokens" integer,"output_tokens" integer,"created_at" timestamp with time zone default now(),"expires_at" timestamp with time zone default now());
create table public.ai_recommendation_feedback ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"user_id" uuid,"cache_id" uuid,"lookup_key" text,"normalized_lookup_key" text,"style_id" uuid,"shown_rank" integer,"source" text,"provider" text,"model_id" text,"created_at" timestamp with time zone default now(),"map_id" uuid,"suggested_style_id" uuid,"outcome" text,"invalidated_at" timestamp with time zone default now());
create table public.attendance_start_options ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"start_time" time without time zone,"created_at" timestamp with time zone default now());
create table public.attendance_start_settings ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"month" date,"department_id" uuid,"employee_id" uuid,"source" text,"start_time" time without time zone,"grace_minutes" integer,"updated_by" uuid,"updated_at" timestamp with time zone default now());
create table public.barcode_data_entry_runs ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"company_key" text,"shipped_on" date,"note" text,"worker_label" text,"created_by" uuid,"registered_at" timestamp with time zone default now(),"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.barcode_partner_display_settings ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"display_scope" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.barcode_partner_display_targets ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"setting_id" uuid,"usage_target_id" uuid,"created_at" timestamp with time zone default now());
create table public.brand_fields ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"label" text,"system_key" text,"type" text,"owner" text,"required" boolean,"sort_order" integer,"level" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.brands ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"slug" text,"name" text,"name_ko" text,"description" text,"color" text,"founded_year" smallint,"logo_url" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.bulk_outbound_job_files ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"job_id" uuid,"file_name" text,"file_size" bigint,"kept_on" date,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.bulk_outbound_job_lines ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"job_id" uuid,"barcode" text,"order_qty" integer,"product_name" text,"source_row_no" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"extra_values" jsonb);
create table public.bulk_outbound_jobs ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"usage_target_id" uuid,"title" text,"status" text,"barcode_source" text,"started_on" date,"due_on" date,"assignee" text,"note" text,"planned_qty" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.bulk_outbound_partner_configs ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"usage_target_id" uuid,"barcode_source" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"work_status" text);
create table public.bulk_outbound_template_fields ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"usage_target_id" uuid,"barcode_source" text,"field_key" text,"label" text,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.cargo_inbound_lines ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"shipment_id" uuid,"source_row_no" integer,"item_no" text,"product_name" text,"style_id" uuid,"source_style_no" text,"quantity" integer,"units_per_box" integer,"box_count" integer,"photo_ref" text,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"request_note" text);
create table public.cargo_inbound_shipments ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"shipment_no" text,"stage" text,"shipped_on" date,"scheduled_inbound_on" date,"port_contact_note" text,"vessel_name" text,"origin_port" text,"warehouse_summary" text,"completed_at" timestamp with time zone default now(),"created_by" uuid,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"tidy_saved_at" timestamp with time zone default now());
create table public.cargo_inbound_tidy_rows ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"shipment_id" uuid,"line_id" uuid,"row_no" integer,"part_index" integer,"item_no" text,"product_name" text,"style_no" text,"quantity" integer,"units_per_box" integer,"box_count" integer,"stow_label" text,"note" text,"shipped_code" text,"latest_slot" text,"latest_box_count" integer,"warehouse_slot" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.code_usage_target_aliases ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"target_id" uuid,"alias" text,"normalized_alias" text,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.code_usage_target_folders ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"parent_id" uuid,"name" text,"normalized_name" text,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.code_usage_targets ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"name" text,"active" boolean,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"normalized_name" text,"channel_type" text,"shipping_method" text,"is_one_time" boolean,"note" text,"folder_id" uuid,"group_id" uuid,"site_name" text,"normalized_site_name" text,"contact_name" text,"contact_phone" text,"contact_email" text,"address" text);
create table public.companies ("id" uuid primary key default gen_random_uuid(),"name" text,"name_ko" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.company_draft_sequences ("company_id" uuid primary key,"last_value" integer,"updated_at" timestamp with time zone default now());
create table public.company_notices ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"slot" text,"department_id" uuid,"title" text,"body" text,"starts_on" date,"ends_on" date,"published" boolean,"updated_by" uuid,"updated_at" timestamp with time zone default now());
create table public.company_work_hours ("company_id" uuid,"lunch_start" time without time zone,"lunch_end" time without time zone,"updated_by" uuid,"updated_at" timestamp with time zone default now());
create table public.departments ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"name" text,"sort_order" integer,"is_active" boolean,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"personnel_scope" text);
create table public.draft_colors ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"draft_id" uuid,"name" text,"order_qty" integer,"sort_order" integer,"created_at" timestamp with time zone default now(),"company_id" uuid,"sample_in_progress" boolean,"sample_work_order_url" text,"sample_work_order_name" text,"sample_work_order_shipped" boolean,"sample_work_order_shipped_at" timestamp with time zone default now());
create table public.draft_options ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"draft_id" uuid,"style_id" uuid,"name" text,"price" numeric,"sort_order" integer,"created_at" timestamp with time zone default now(),"company_id" uuid);
create table public.employee_roster ("profile_id" uuid,"company_id" uuid,"phone" text,"bank_name" text,"bank_account" text,"resident_id" text,"home_address" text,"gmail" text,"naver_email" text,"workplace" text,"employment_type" text,"gender" text,"resigned_on" date,"job_description" text,"work_days" text,"work_hours" text,"break_time" text,"pay_basis" text,"annual_salary" text,"monthly_wage" text,"meal_allowance" text,"car_allowance" text,"childcare_allowance" text,"duty_allowance" text,"note" text,"extra" text,"updated_at" timestamp with time zone default now(),"remaining_annual_leave" numeric(7,2),"inclusive_overtime_hours" numeric(7,2));
create table public.invoice_accessory_rules ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"rule_type" text,"pattern" text,"normalized_pattern" text,"accessory_kind" text,"name_prefix" text,"color_name" text,"target_style_id" uuid,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_discontinued_styles ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"style_id" uuid,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_gift_allocations ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"request_id" uuid,"item_id" uuid,"style_id" uuid,"mall_name" text,"customer_order_no" text,"ordered_at" timestamp without time zone,"order_fingerprint" text,"allocation_key" text,"gift_slot_index" integer,"source_file_name" text,"cancelled_at" timestamp with time zone default now(),"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_gift_quotas ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"request_id" uuid,"style_id" uuid,"quantity_limit" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_gift_source_allocations ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"map_id" uuid,"style_id" uuid,"allocation_key" text,"order_fingerprint" text,"quantity_slot" integer,"mall_name" text,"customer_order_no" text,"ordered_at" timestamp without time zone,"source_file_name" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_gift_source_map_products ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"map_id" uuid,"style_id" uuid,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_gift_source_maps ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"mall_name" text,"normalized_mall_name" text,"product_name" text,"normalized_product_name" text,"assignment_mode" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"unique_per_recipient" boolean);
create table public.invoice_item_name_rule_components ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"rule_id" uuid,"style_id" uuid,"role" text,"quantity" integer,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.invoice_item_name_rules ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"scope" text,"main_style_id" uuid,"item_name" text,"normalized_item_name" text,"action" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"product_lookup_key" text,"normalized_product_lookup_key" text);
create table public.invoice_name_rules ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"match_type" text,"source_value" text,"normalized_source_value" text,"target_name" text,"is_active" boolean,"is_test" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"action" text,"target_style_id" uuid);
create table public.invoice_option_map_components ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"map_id" uuid,"style_id" uuid,"role" text,"quantity" integer,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.invoice_option_maps ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"mall_name" text,"normalized_mall_name" text,"product_name" text,"normalized_product_name" text,"item_name" text,"normalized_item_name" text,"own_product_code" text,"normalized_own_product_code" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"display_item_name" text);
create table public.invoice_packing_size_maps ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"field_id" uuid,"source_value" text,"normalized_source_value" text,"display_value" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_picking_route_presets ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"warehouse_zone" text,"name" text,"sort_order" integer,"route_groups" jsonb,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_prefix_item_products ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"item_id" uuid,"style_id" uuid,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.invoice_prefix_items ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"request_id" uuid,"product_name" text,"normalized_product_name" text,"prefix" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"outgoing_product_names" text[],"is_random" boolean);
create table public.invoice_prefix_requests ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"title" text,"task_no" text,"mall_name" text,"normalized_mall_name" text,"starts_at" timestamp without time zone,"ends_at" timestamp without time zone,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"count_basis" text,"merge_basis" text,"uses_first_come" boolean,"first_come_limit_mode" text,"first_come_total_limit" integer);
create table public.invoice_preorder_hold_extensions ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"hold_id" uuid,"previous_ship_on" date,"new_ship_on" date,"reason" text,"created_at" timestamp with time zone default now());
create table public.invoice_preorder_holds ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"style_id" uuid,"started_on" date,"ship_on" date,"reason" text,"status" text,"cleared_at" timestamp with time zone default now(),"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"ended_on" date,"ended_reason" text);
create table public.invoice_product_name_exclusions ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"mall_name" text,"normalized_mall_name" text,"product_name" text,"normalized_product_name" text,"item_name" text,"normalized_item_name" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_product_name_maps ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"mall_name" text,"normalized_mall_name" text,"product_name" text,"normalized_product_name" text,"item_name_context" text,"normalized_item_name_context" text,"own_product_code" text,"normalized_own_product_code" text,"style_id" uuid,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"lookup_key" text,"normalized_lookup_key" text);
create table public.invoice_product_name_tag_roles ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"tag_text" text,"normalized_tag" text,"role" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_work_instruction_items ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"instruction_id" uuid,"product_name" text,"normalized_product_name" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_work_instruction_products ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"instruction_id" uuid,"style_id" uuid,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.invoice_work_instructions ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"title" text,"label_text" text,"is_active" boolean,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"starts_at" timestamp without time zone,"ends_at" timestamp without time zone,"count_basis" text,"match_mode" text);
create table public.invoice_work_run_order_keys ("brand_id" uuid,"run_id" uuid,"order_key_hash" text,"created_at" timestamp with time zone default now());
create table public.invoice_work_runs ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"file_fingerprint" text,"source_file_name" text,"completed_by" uuid,"worker_label" text,"completed_at" timestamp with time zone default now(),"source_row_count" integer,"source_order_count" integer,"exported_row_count" integer,"review_row_count" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.invoice_work_site_summaries ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"run_id" uuid,"usage_target_id" uuid,"source_mall_names" text,"order_count" integer,"source_row_count" integer,"source_quantity" integer,"cj_order_row_count" integer,"cj_order_quantity" integer,"cj_gift_row_count" integer,"cj_gift_quantity" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.outbound_partner_groups ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"name" text,"normalized_name" text,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.outbound_shipments ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"style_id" uuid,"usage_target_id" uuid,"shipped_on" date,"quantity" integer,"source" text,"source_ref" text,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.permission_grants ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"profile_id" uuid,"permission" text,"scope_kind" text,"scope_id" uuid,"updated_by" uuid,"updated_at" timestamp with time zone default now());
create table public.personnel_titles ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"kind" text,"name" text,"sort_order" integer,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.product_code_components ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"product_code_id" uuid,"style_id" uuid,"style_no" text,"qty" integer,"sort_order" integer,"created_at" timestamp with time zone default now());
create table public.product_codes ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"kind" text,"code" text,"name" text,"weight_g" integer,"width_cm" numeric(8,1),"depth_cm" numeric(8,1),"height_cm" numeric(8,1),"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"values" jsonb,"usage_target_id" uuid);
create table public.product_drafts ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"season_id" uuid,"draft_no" text,"status" text,"owner" text,"name_ko" text,"name_en" text,"image_url" text,"sample_done" boolean,"order_done" boolean,"photo_sample_done" boolean,"held" boolean,"hold_reason" text,"held_at" timestamp with time zone default now(),"target_cost" numeric,"cost_currency" text,"cost_confirmed" boolean,"retail_price" numeric,"discount_price" numeric,"origin_country" text,"register_type" text,"open_type" text,"open_type_detail" text,"release_issue" text,"specs" jsonb,"has_options" boolean,"note" text,"promoted_style_id" uuid,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"company_id" uuid,"order_in_progress" boolean,"sample_work_order_url" text,"sample_work_order_name" text,"sample_work_orders" jsonb);
create table public.profile_capabilities ("profile_id" uuid,"capability" text,"created_at" timestamp with time zone default now());
create table public.profiles ("id" uuid primary key default gen_random_uuid(),"email" text,"display_name" text,"avatar_url" text,"department_id" uuid,"position" text,"is_admin" boolean,"status" text,"requested_at" timestamp with time zone default now(),"approved_by" uuid,"approved_at" timestamp with time zone default now(),"request_note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"company_id" uuid,"name_confirmed_at" timestamp with time zone default now(),"job_grade" text,"hire_date" date);
create table public.seasons ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"code" text,"name" text,"release_timing" text,"year" smallint,"status" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.styles ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"season_id" uuid,"style_no" text,"name" text,"category" text,"gender" text,"colors" jsonb,"target_cost" numeric,"planned_qty" integer,"retail_price" numeric,"status" text,"designer" text,"planner" text,"thumbnail_color" text,"description" text,"weight_g" integer,"values" jsonb,"custom_fields" jsonb,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.warehouse_box_movements ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"box_id" uuid,"action" text,"from_location_id" uuid,"from_location_code" text,"from_zone" text,"to_location_id" uuid,"to_location_code" text,"to_zone" text,"from_qty" integer,"to_qty" integer,"reason" text,"actor_id" uuid,"created_at" timestamp with time zone default now());
create table public.warehouse_boxes ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"set_id" uuid,"display_code" text,"location_id" uuid,"style_id" uuid,"received_on" date,"initial_qty" integer,"current_qty" integer,"status" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"usage_priority" text,"note" text,"source_position_id" uuid,"created_by" uuid,"archived_at" timestamp with time zone default now(),"archived_by" uuid,"completed_at" timestamp with time zone default now(),"completed_by" uuid,"completion_kind" text);
create table public.warehouse_inventory_sets ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"warehouse_id" uuid,"kind" text,"status" text,"source_file_name" text,"row_count" integer,"imported_at" timestamp with time zone default now(),"imported_by" uuid,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.warehouse_locations ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"warehouse_id" uuid,"code" text,"zone" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.warehouse_registered_slots ("warehouse_id" uuid,"code" text,"zone" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
create table public.warehouse_stock_movements ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"set_id" uuid,"action" text,"position_id" uuid,"box_id" uuid,"style_id" uuid,"from_location_code" text,"to_location_code" text,"box_count" integer,"unit_count" integer,"reason" text,"actor_id" uuid,"created_at" timestamp with time zone default now());
create table public.warehouse_stock_positions ("id" uuid primary key default gen_random_uuid(),"brand_id" uuid,"set_id" uuid,"warehouse_id" uuid,"location_id" uuid,"style_id" uuid,"source_style_no" text,"normalized_style_no" text,"source_product_name" text,"received_on" date,"received_on_raw" text,"is_forced_priority" boolean,"is_final_location" boolean,"units_per_box" integer,"remaining_boxes" integer,"opened_units" integer,"review_flags" text[],"source_row_number" integer,"note" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"usage_priority" text,"quantity_status" text,"units_per_box_raw" text,"remaining_boxes_raw" text,"external_row_id" text);
create table public.warehouses ("id" uuid primary key default gen_random_uuid(),"company_id" uuid,"name" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now());
grant select,insert,update,delete on all tables in schema public to authenticated;
CREATE OR REPLACE FUNCTION app.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  );
$function$
;
CREATE OR REPLACE FUNCTION app.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION app.has_any_capability()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    app.is_admin()
    or exists (
      select 1
      from public.profile_capabilities pc
      join public.profiles p on p.id = pc.profile_id
      where pc.profile_id = auth.uid()
        and p.status = 'active'
    );
$function$
;
CREATE OR REPLACE FUNCTION app.has_capability(target_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    app.is_admin()
    or exists (
      select 1
      from public.profile_capabilities pc
      join public.profiles p on p.id = pc.profile_id
      where pc.profile_id = auth.uid()
        and pc.capability = target_capability
        and p.status = 'active'
    );
$function$
;
CREATE OR REPLACE FUNCTION app.can_read_brand(target_brand_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.is_admin() or app.is_approved();
$function$
;
CREATE OR REPLACE FUNCTION app.can_edit_brand(target_brand_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.is_admin() or (app.is_approved() and app.has_any_capability());
$function$
;
CREATE OR REPLACE FUNCTION app.can_read_company(target_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    target_company_id is not null
    and (
      app.is_admin()
      or (
        app.is_approved()
        and exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = target_company_id
        )
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION app.can_edit_company(target_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.is_admin()
    or (app.can_read_company(target_company_id) and app.has_any_capability());
$function$
;
CREATE OR REPLACE FUNCTION app.permission_allowed(p_permission text, p_kind text DEFAULT 'company'::text, p_scope uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id
 where p.id=auth.uid() and p.status='active' and p.company_id=g.company_id and g.permission=p_permission
 and ((g.scope_kind='company' and g.scope_id=p.company_id) or (g.scope_kind=p_kind and p_scope is not null and g.scope_id=p_scope)));
$function$
;
CREATE OR REPLACE FUNCTION app.draft_brand_in_company(target_company_id uuid, target_brand_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    target_brand_id is null
    or exists (
      select 1
      from public.brands b
      where b.id = target_brand_id
        and b.company_id = target_company_id
    );
$function$
;
CREATE OR REPLACE FUNCTION app.normalize_select_label(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  select lower(btrim(regexp_replace(normalize(coalesce(value, ''), NFKC), '\s+', ' ', 'g')));
$function$
;
alter table public.product_drafts enable row level security;
create policy "product_drafts_delete" on public.product_drafts for DELETE to authenticated using (app.can_edit_company(company_id)) ;
create policy "product_drafts_insert" on public.product_drafts for INSERT to authenticated  with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
create policy "product_drafts_select" on public.product_drafts for SELECT to authenticated using (app.can_read_company(company_id)) ;
create policy "product_drafts_update" on public.product_drafts for UPDATE to authenticated using (app.can_edit_company(company_id)) with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
alter table public.draft_colors enable row level security;
create policy "draft_colors_delete" on public.draft_colors for DELETE to authenticated using (app.can_edit_company(company_id)) ;
create policy "draft_colors_insert" on public.draft_colors for INSERT to authenticated  with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
create policy "draft_colors_select" on public.draft_colors for SELECT to authenticated using (app.can_read_company(company_id)) ;
create policy "draft_colors_update" on public.draft_colors for UPDATE to authenticated using (app.can_edit_company(company_id)) with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
alter table public.draft_options enable row level security;
create policy "draft_options_delete" on public.draft_options for DELETE to authenticated using (app.can_edit_company(company_id)) ;
create policy "draft_options_insert" on public.draft_options for INSERT to authenticated  with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
create policy "draft_options_select" on public.draft_options for SELECT to authenticated using (app.can_read_company(company_id)) ;
create policy "draft_options_update" on public.draft_options for UPDATE to authenticated using (app.can_edit_company(company_id)) with check ((app.can_edit_company(company_id) AND app.draft_brand_in_company(company_id, brand_id)));
alter table public.styles enable row level security;
create policy "styles_all_member" on public.styles for ALL to authenticated using (app.can_read_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.seasons enable row level security;
create policy "seasons_all_member" on public.seasons for ALL to authenticated using (app.can_read_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.warehouse_stock_positions enable row level security;
create policy "warehouse_stock_positions_select_member" on public.warehouse_stock_positions for SELECT to authenticated using (app.can_read_brand(brand_id)) ;
create policy "warehouse_stock_positions_write_editor" on public.warehouse_stock_positions for ALL to authenticated using (app.can_edit_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.bulk_outbound_jobs enable row level security;
create policy "bulk_outbound_jobs_all_member" on public.bulk_outbound_jobs for ALL to authenticated using (app.can_read_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.cargo_inbound_shipments enable row level security;
create policy "cargo_inbound_shipments_delete" on public.cargo_inbound_shipments for DELETE to authenticated using (app.can_edit_brand(brand_id)) ;
create policy "cargo_inbound_shipments_insert" on public.cargo_inbound_shipments for INSERT to authenticated  with check (app.can_edit_brand(brand_id));
create policy "cargo_inbound_shipments_select" on public.cargo_inbound_shipments for SELECT to authenticated using (app.can_read_brand(brand_id)) ;
create policy "cargo_inbound_shipments_update" on public.cargo_inbound_shipments for UPDATE to authenticated using (app.can_read_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.ai_recommendation_feedback enable row level security;
create policy "ai_recommendation_feedback_insert_member" on public.ai_recommendation_feedback for INSERT to authenticated  with check (app.can_edit_brand(brand_id));
create policy "ai_recommendation_feedback_select_member" on public.ai_recommendation_feedback for SELECT to authenticated using (app.can_read_brand(brand_id)) ;
create policy "ai_recommendation_feedback_update_member" on public.ai_recommendation_feedback for UPDATE to authenticated using (app.can_edit_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.ai_item_name_recommendation_feedback enable row level security;
create policy "ai_item_name_feedback_delete_member" on public.ai_item_name_recommendation_feedback for DELETE to authenticated using (app.can_edit_brand(brand_id)) ;
create policy "ai_item_name_feedback_insert_member" on public.ai_item_name_recommendation_feedback for INSERT to authenticated  with check (app.can_edit_brand(brand_id));
create policy "ai_item_name_feedback_select_member" on public.ai_item_name_recommendation_feedback for SELECT to authenticated using (app.can_read_brand(brand_id)) ;
create policy "ai_item_name_feedback_update_member" on public.ai_item_name_recommendation_feedback for UPDATE to authenticated using (app.can_edit_brand(brand_id)) with check (app.can_edit_brand(brand_id));
alter table public.ai_item_name_recommendation_feedback_components enable row level security;
create policy "ai_item_name_feedback_components_delete_member" on public.ai_item_name_recommendation_feedback_components for DELETE to authenticated using (app.can_edit_brand(brand_id)) ;
create policy "ai_item_name_feedback_components_insert_member" on public.ai_item_name_recommendation_feedback_components for INSERT to authenticated  with check (app.can_edit_brand(brand_id));
create policy "ai_item_name_feedback_components_select_member" on public.ai_item_name_recommendation_feedback_components for SELECT to authenticated using (app.can_read_brand(brand_id)) ;
create policy "ai_item_name_feedback_components_update_member" on public.ai_item_name_recommendation_feedback_components for UPDATE to authenticated using (app.can_edit_brand(brand_id)) with check (app.can_edit_brand(brand_id));
