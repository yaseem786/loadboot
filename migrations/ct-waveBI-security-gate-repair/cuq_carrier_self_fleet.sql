-- cuq_carrier_self_fleet.sql
-- Carrier self-service management of their OWN drivers and trucks (Carrier Portal "Fleet" tab).
-- Self-scoping: the carrier org is resolved server-side via app_private.my_carrier_org(); every read and
-- write is constrained to that org (WHERE carrier_id = my org), so a carrier can never see or modify
-- another carrier's fleet. All four RPCs are SECURITY DEFINER, deny-by-default (anon/public revoked,
-- authenticated granted), and audited on write.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_drivers()
returns table(id uuid, name text, phone text, email text, license_no text, license_state text, license_exp date, medical_exp date, status text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select d.id,d.name,d.phone,d.email,d.license_no,d.license_state,d.license_exp,d.medical_exp,coalesce(d.status,'active')
    from app_private.fleet_drivers d where d.carrier_id=v_org order by d.created_at desc;
end; $$;
revoke execute on function public.cc_pocket_drivers() from anon, public;
grant  execute on function public.cc_pocket_drivers() to authenticated;

create or replace function public.cc_pocket_upsert_driver(p_id uuid, p_name text, p_phone text default null, p_email text default null, p_license_no text default null, p_license_state text default null, p_license_exp date default null, p_medical_exp date default null)
returns uuid
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'driver name required' using errcode='22023'; end if;
  if p_id is null then
    insert into app_private.fleet_drivers(carrier_id,name,phone,email,license_no,license_state,license_exp,medical_exp,created_by,status)
      values (v_org,btrim(p_name),p_phone,p_email,p_license_no,p_license_state,p_license_exp,p_medical_exp,auth.uid(),'active') returning id into v_id;
  else
    update app_private.fleet_drivers set name=btrim(p_name),phone=p_phone,email=p_email,license_no=p_license_no,license_state=p_license_state,license_exp=p_license_exp,medical_exp=p_medical_exp
      where id=p_id and carrier_id=v_org returning id into v_id;
    if v_id is null then raise exception 'driver not found for your account' using errcode='42501'; end if;
  end if;
  perform app_private.log_audit('carrier.driver.upsert','fleet_driver',v_id::text,null,format('driver %s',p_name),'{}'::jsonb);
  return v_id;
end; $$;
revoke execute on function public.cc_pocket_upsert_driver(uuid,text,text,text,text,text,date,date) from anon, public;
grant  execute on function public.cc_pocket_upsert_driver(uuid,text,text,text,text,text,date,date) to authenticated;

create or replace function public.cc_pocket_trucks()
returns table(id uuid, unit_no text, plate text, vin text, equipment text, status text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select t.id,t.unit_no,t.plate,t.vin,t.equipment,coalesce(t.status,'active')
    from app_private.fleet_trucks t where t.carrier_id=v_org order by t.created_at desc;
end; $$;
revoke execute on function public.cc_pocket_trucks() from anon, public;
grant  execute on function public.cc_pocket_trucks() to authenticated;

create or replace function public.cc_pocket_upsert_truck(p_id uuid, p_unit_no text, p_plate text default null, p_vin text default null, p_equipment text default null)
returns uuid
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_unit_no is null or btrim(p_unit_no)='' then raise exception 'unit number required' using errcode='22023'; end if;
  if p_id is null then
    insert into app_private.fleet_trucks(carrier_id,unit_no,plate,vin,equipment,status)
      values (v_org,btrim(p_unit_no),p_plate,p_vin,p_equipment,'active') returning id into v_id;
  else
    update app_private.fleet_trucks set unit_no=btrim(p_unit_no),plate=p_plate,vin=p_vin,equipment=p_equipment
      where id=p_id and carrier_id=v_org returning id into v_id;
    if v_id is null then raise exception 'truck not found for your account' using errcode='42501'; end if;
  end if;
  perform app_private.log_audit('carrier.truck.upsert','fleet_truck',v_id::text,null,format('unit %s',p_unit_no),'{}'::jsonb);
  return v_id;
end; $$;
revoke execute on function public.cc_pocket_upsert_truck(uuid,text,text,text,text) from anon, public;
grant  execute on function public.cc_pocket_upsert_truck(uuid,text,text,text,text) to authenticated;
