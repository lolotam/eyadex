import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDatabase } from "@eyadex/db";

export async function fixture() {
  const owner = postgres(process.env.EYADEX_TEST_OWNER_URL, { onnotice: () => {} });
  const db = createDatabase({
    url: process.env.EYADEX_TEST_APP_URL,
    role: "eyadex_app",
    ids: { newId: randomUUID },
    maxConnections: 20,
  });
  const clinics = [];
  for (let n = 0; n < 11; n++) {
    const id = randomUUID();
    await owner`INSERT INTO clinics (id,slug,name_ar,name_en,specialty,default_language,timezone,
      status,expires_at,max_users,max_branches,created_at,updated_at)
      VALUES (${id},${id},'synthetic','synthetic','general','en','UTC','active',now()+interval '1 day',10,10,now(),now())`;
    await owner`INSERT INTO branches (clinic_id,id,name_ar,name_en,is_active,created_at,updated_at)
      VALUES (${id},${id},'synthetic','synthetic',true,now(),now())`;
    await owner`INSERT INTO patients (clinic_id,id,file_number,full_name,phone,birth_date,gender,
      registration_branch_id,status,created_at,updated_at)
      VALUES (${id},${id},'1','synthetic','+96500000000','2000-01-01','male',${id},'active',now(),now())`;
    const invoices = [];
    for (let i = 0; i < 11; i++) {
      const invoice = randomUUID();
      await owner`INSERT INTO invoices (clinic_id,id,branch_id,patient_id,year,number_seq,number,status,source,
        issued_at,currency,currency_exponent,subtotal_minor,discount_minor,tax_rate_bp,tax_minor,total_minor,
        created_by,created_at,updated_at)
        VALUES (${id},${invoice},${id},${id},2026,${i + 1},${`SYN-${i + 1}`},'issued','manual',now(),
        'KWD',3,0,0,0,0,0,${id},now(),now())`;
      invoices.push(invoice);
    }
    clinics.push({ id, invoices });
  }
  const id = clinics[0].id;
  await owner`INSERT INTO roles (clinic_id,id,name_ar,name_en,is_locked,is_active,created_at,updated_at)
    VALUES (${id},${id},'synthetic','synthetic',false,true,now(),now())`;
  await owner`INSERT INTO memberships (clinic_id,id,user_id,full_name,email,role_id,all_branches,status,preferred_language,created_at,updated_at)
    VALUES (${id},${id},${id},'synthetic',${`${id}@example.invalid`},${id},true,'active','en',now(),now())`;
  await owner`INSERT INTO clinic_features (clinic_id,id,module,enabled,updated_at) VALUES (${id},${randomUUID()},'finance',true,now())
    ON CONFLICT (clinic_id,module) DO UPDATE SET enabled=true`;
  await owner`INSERT INTO role_permissions (clinic_id,id,role_id,permission_id,created_at)
    SELECT ${id},${randomUUID()},${id},id,now() FROM permissions WHERE key='view:invoices:clinic'`;
  return { owner, db, clinics };
}
