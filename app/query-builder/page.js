"use client";

import { useState, useMemo, useEffect, useCallback } from "react";

/* ─── Colour tokens (matched from main dashboard) ─────────── */
const C = {
  accent: "#00E5A0", accentDim: "#00B87D",
  bg: "#0B0F1A", card: "#111827", elevated: "#1A2332",
  border: "#1E2D3D", text: "#F0F4F8", sub: "#8899AA", muted: "#556677",
  danger: "#FF5C5C", warn: "#FFB84D", success: "#34D399",
  purple: "#A78BFA", purpleDim: "#7C3AED",
  blue: "#60A5FA", blueDim: "#3B82F6",
  code: { bg: "#0D1117", text: "#E6EDF3", kw: "#CBA6F7", str: "#A6E3A1", num: "#FAB387", col: "#89B4FA", comment: "#6C7086" },
};

/* ─── Utilities ────────────────────────────────────────────── */
function esc(str) { return str ? String(str).replace(/'/g, "''") : ""; }
function isNum(v) { return v !== "" && v !== undefined && v !== null && !isNaN(Number(v)); }

/* ─── SQL Syntax Highlighter ───────────────────────────────── */
function highlightSQL(sql) {
  const kws = ["SELECT","FROM","LEFT JOIN","RIGHT JOIN","INNER JOIN","CROSS JOIN","JOIN","ON","WHERE","AND","OR","AS","IS","NOT","NULL","IN","LIKE","BETWEEN","ORDER BY","GROUP BY","HAVING","LIMIT","CONCAT","TIMESTAMPDIFF","YEAR","CURDATE","NOW","DATE_ADD","DATE_SUB","INTERVAL","COUNT","SUM","AVG","MAX","MIN","DISTINCT","CASE","WHEN","THEN","ELSE","END","COALESCE","IFNULL","IF","NULLIF","EXISTS","WITH","DESC","ASC","CAST","UNSIGNED","SUBSTRING","JSON_EXTRACT","JSON_UNQUOTE","GROUP_CONCAT","SEPARATOR","CONCAT_WS","DAY"];
  let r = sql.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  r = r.replace(/'([^']*)'/g, `<span style="color:${C.code.str}">'$1'</span>`);
  r = r.replace(/\b(\d+\.?\d*)\b/g, `<span style="color:${C.code.num}">$1</span>`);
  kws.forEach(kw => { r = r.replace(new RegExp(`\\b${kw}\\b`,"gi"), m => `<span style="color:${C.code.kw};font-weight:600">${m.toUpperCase()}</span>`); });
  r = r.replace(/`([^`]*)`/g, `<span style="color:${C.code.col}">\`$1\`</span>`);
  r = r.replace(/(--.*$)/gm, `<span style="color:${C.code.comment};font-style:italic">$1</span>`);
  return r;
}

/* ─── Status Maps ──────────────────────────────────────────── */
const STATUS_MAPS = {
  hmo_status: { label: "HMO Status", values: { "-1": "Rejected", "0": "Pending", "1": "Approved" } },
  provider_status: { label: "Provider Status", values: { "-1": "Draft", "0": "Pending", "1": "Submitted" } },
};

const HMO_LIST = [
  { id: 73, name: "UAP Old Mutual (Uganda)" }, { id: 4, name: "UAP (Legacy ID)" },
  { id: 38, name: "HMO Partner 38" }, { id: 74, name: "Jubilee Health (Kenya)" },
  { id: 75, name: "Jubilee Health (Tanzania)" }, { id: 76, name: "AXA Mansard" },
  { id: 77, name: "Cornerstone Insurance" }, { id: 78, name: "Universal Insurance" },
  { id: 0, name: "— Enter Custom ID —" },
];

/* ─── Query Safety ─────────────────────────────────────────── */
const LIMIT = 1000;
const HEAVY = new Set(["full_claims_extract","claims_summary","erp_detail_list","tariff_full_export","tariff_with_variations","v1_with_variations","todays_claims"]);
function isExpensive(key, f) {
  if (!HEAVY.has(key)) return false;
  return !(f.hmo_id && f.hmo_id !== "" && f.hmo_id !== "0") && !(f.date_from && f.date_to);
}

/* ─── Schema for Custom Builder ────────────────────────────── */
const TABLES = {
  claims: { alias: "c", label: "Claims", size: "5.3M rows", cols: ["id","hmo_id","provider_id","enrollee_id","encounter_date","total_amount","approved_amount","auto_vet_amount","hmo_status","provider_status","hmo_erp_id","approval_code","entry_point","hmo_pile_id","has_unmatched_tariff","vetted_at","submitted_at","created_at","updated_at","paid_at"] },
  claim_items: { alias: "ci", label: "Claim Items", size: "24.7M rows", cols: ["id","claim_id","care_id","tariff_id","description","qty","amount","unit_price_billed","unit_price_approved","approved_amount","approved_qty","hmo_approved","comment_id","provider_comment"] },
  providers: { alias: "p", label: "Providers", size: "9.8K rows", cols: ["id","name","email","phone","address","state","nhis_code","category_id"] },
  enrollees: { alias: "e", label: "Enrollees", size: "2M rows", cols: ["id","hmo_id","insurance_no","firstname","lastname","middle_name","sex","birthdate","status","hmo_plan_id","hmo_client_id","state","lga"] },
  hmos: { alias: "h", label: "HMOs", size: "167 rows", cols: ["id","name","code","email","currency","country_id","is_active"] },
  provider_tariffs: { alias: "pt", label: "Provider Tariffs", size: "18.9M rows", cols: ["id","hmo_id","provider_id","care_id","care_variation_id","desc","amount","amount_max","flagged_as_correct_at","is_approved","created_at","updated_at"] },
  cares: { alias: "ca", label: "Cares", size: "398K rows", cols: ["id","name","base_name","type","type_id","active","cve_version","gender_limit","age_min","age_max"] },
  care_variations: { alias: "cv", label: "Care Variations", size: "30K rows", cols: ["id","care_id","age_min","age_max","meta"] },
};

const JOINS = {
  claims: {
    providers: { on: "`c`.`provider_id` = `p`.`id`", label: "Provider details" },
    enrollees: { on: "`c`.`enrollee_id` = `e`.`id`", label: "Enrollee details" },
    hmos: { on: "`c`.`hmo_id` = `h`.`id`", label: "HMO name" },
    claim_items: { on: "`c`.`id` = `ci`.`claim_id`", label: "Line items" },
  },
  claim_items: {
    claims: { on: "`ci`.`claim_id` = `c`.`id`", label: "Parent claim" },
    cares: { on: "`ci`.`care_id` = `ca`.`id`", label: "Care catalog" },
    provider_tariffs: { on: "`ci`.`tariff_id` = `pt`.`id`", label: "Tariff pricing" },
  },
  provider_tariffs: {
    hmos: { on: "`pt`.`hmo_id` = `h`.`id`", label: "HMO name" },
    providers: { on: "`pt`.`provider_id` = `p`.`id`", label: "Provider name" },
    cares: { on: "`pt`.`care_id` = `ca`.`id`", label: "Care catalog" },
    care_variations: { on: "`pt`.`care_variation_id` = `cv`.`id`", label: "Variation details" },
  },
  enrollees: { hmos: { on: "`e`.`hmo_id` = `h`.`id`", label: "HMO name" } },
  cares: { care_variations: { on: "`cv`.`care_id` = `ca`.`id`", label: "Variations" } },
};

const OPS = ["=","!=",">",">=","<","<=","LIKE","IS NULL","IS NOT NULL","IN"];

/* ─── Schema Context for AI ────────────────────────────────── */
const SCHEMA_CONTEXT = `You are a MySQL query generator for Curacel's health insurance platform. Generate ONLY the SQL query, no explanation.

DATABASE SCHEMA:
1. claims (5.3M rows) - id, hmo_id, provider_id, enrollee_id, encounter_date, total_amount, approved_amount, provider_status (0=Pending,1=Submitted,-1=Draft), hmo_status (0=Pending,1=Approved,-1=Rejected), hmo_erp_id, created_at, submitted_at, vetted_at, has_unmatched_tariff, hmo_pile_id, approval_code, entry_point
2. claim_items (24.7M rows) - id, claim_id, care_id, tariff_id, description, qty, amount, approved_amount, approved_qty, comment_id, hmo_approved
3. provider_tariffs (18.9M rows) - id, hmo_id, provider_id, care_id, care_variation_id, desc, amount, flagged_as_correct_at, created_at
4. cares (398K rows) - id, name, type, type_id (1=medications), cve_version (2=V2), active
5. care_variations (30K rows) - id, care_id, meta (JSON: $.strength, $.drug_form_id)
6. enrollees (2M rows) - id, hmo_id, insurance_no, firstname, lastname, birthdate, sex, status
7. providers (9.8K rows) - id, name, email, state
8. hmos (167 rows) - id, name, code, country_id
Related: claim_item_comments (id, name), drug_forms (id, name)

RULES: Use backticks, LEFT JOINs by default, LIMIT 1000 unless aggregation, >= start AND < end for dates, ORDER BY newest first. Return ONLY SQL.`;


/* ═══════════════════════════════════════════════════════════
   PLAYBOOK TEMPLATES
   ═══════════════════════════════════════════════════════════ */
const CATS = {
  ai_assistant: { name: "AI Assistant", icon: "🤖", desc: "Type what you need in plain English — AI writes the SQL for you", templates: {} },
  custom_builder: { name: "Custom Builder", icon: "🔨", desc: "Build queries visually — pick tables, columns, joins, and filters step by step", templates: {} },
  claims_reports: { name: "Claims Reports", icon: "📋", desc: "Pre-built queries for claims data with provider, enrollee, and item details", templates: {
    full_claims_extract: { name: "Full Claims Extract", desc: "Detailed claims with items, enrollees, and provider info", heavy: true,
      filters: ["hmo_id","date_range","date_field","hmo_status","provider_status","provider_name","vetted_only","has_unmatched_tariff"],
      build: (f, lim) => {
        let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`claims\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(isNum(f.hmo_status)) w.push(`  \`claims\`.\`hmo_status\` = ${Number(f.hmo_status)}`);
        if(isNum(f.provider_status)) w.push(`  \`claims\`.\`provider_status\` = ${Number(f.provider_status)}`);
        if(f.provider_name) w.push(`  \`providers\`.\`name\` LIKE '%${esc(f.provider_name)}%'`);
        if(f.vetted_only) w.push("  `claims`.`vetted_at` IS NOT NULL");
        if(f.has_unmatched_tariff) w.push("  `claims`.`has_unmatched_tariff` = 1");
        const df=f.date_field||"created_at";
        if(f.date_from) w.push(`  \`claims\`.\`${esc(df)}\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`claims\`.\`${esc(df)}\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `SELECT\n  \`claims\`.\`id\`,\n  \`claims\`.\`hmo_id\`,\n  \`providers\`.\`name\` AS \`Provider_Name\`,\n  CONCAT(\`enrollees\`.\`firstname\`, ' ', \`enrollees\`.\`lastname\`) AS \`Enrollee_Name\`,\n  TIMESTAMPDIFF(YEAR, \`enrollees\`.\`birthdate\`, CURDATE()) AS \`Enrollee_Age\`,\n  \`claims\`.\`encounter_date\`,\n  \`enrollees\`.\`insurance_no\`,\n  \`claims\`.\`total_amount\` AS \`Amount_Submitted\`,\n  \`claims\`.\`approved_amount\` AS \`Amount_Approved\`,\n  \`claims\`.\`submitted_at\`,\n  \`claims\`.\`provider_status\`,\n  \`claims\`.\`hmo_status\`,\n  \`claims\`.\`hmo_pile_id\`,\n  \`claims\`.\`approval_code\`,\n  \`claims\`.\`vetted_at\`,\n  \`claims\`.\`hmo_erp_id\`,\n  \`claims\`.\`entry_point\`,\n  \`claim_items\`.\`description\` AS \`Item_Name\`,\n  \`claim_items\`.\`id\` AS \`Item_ID\`,\n  \`claim_items\`.\`qty\` AS \`Item_Qty\`,\n  \`claim_items\`.\`amount\` AS \`Item_Billed\`,\n  \`claim_items\`.\`approved_amount\` AS \`Item_Approved\`,\n  \`claim_items\`.\`approved_qty\`,\n  \`claim_item_comments\`.\`name\` AS \`Item_Comment\`\nFROM \`claims\`\nLEFT JOIN \`providers\` ON \`claims\`.\`provider_id\` = \`providers\`.\`id\`\nLEFT JOIN \`enrollees\` ON \`claims\`.\`enrollee_id\` = \`enrollees\`.\`id\`\nLEFT JOIN \`claim_items\` ON \`claims\`.\`id\` = \`claim_items\`.\`claim_id\`\nLEFT JOIN \`claim_item_comments\` ON \`claim_items\`.\`comment_id\` = \`claim_item_comments\`.\`id\`${w.length?"\nWHERE\n"+w.join("\n  AND "):""}\nORDER BY \`claims\`.\`created_at\` DESC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
    claims_summary: { name: "Claims Summary (Grouped)", desc: "Aggregated claim counts and amounts per claim", heavy: true,
      filters: ["hmo_id","date_range","date_field","provider_status","provider_name"],
      build: (f, lim) => {
        let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`claims\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(isNum(f.provider_status)) w.push(`  \`claims\`.\`provider_status\` = ${Number(f.provider_status)}`);
        if(f.provider_name) w.push(`  \`providers\`.\`name\` = '${esc(f.provider_name)}'`);
        const df=f.date_field||"encounter_date";
        if(f.date_from) w.push(`  \`claims\`.\`${esc(df)}\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`claims\`.\`${esc(df)}\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `SELECT\n  \`claims\`.\`id\` AS \`Claim_ID\`,\n  \`claims\`.\`hmo_id\`,\n  \`providers\`.\`name\` AS \`Provider_Name\`,\n  CONCAT(\`enrollees\`.\`firstname\`, ' ', \`enrollees\`.\`lastname\`) AS \`Enrollee_Name\`,\n  \`claims\`.\`encounter_date\`,\n  \`claims\`.\`total_amount\`,\n  \`claims\`.\`approved_amount\`,\n  COUNT(DISTINCT \`claim_items\`.\`id\`) AS \`Item_Count\`,\n  SUM(\`claim_items\`.\`amount\`) AS \`Total_Item_Billed\`,\n  SUM(\`claim_items\`.\`approved_amount\`) AS \`Total_Item_Approved\`\nFROM \`claims\`\nLEFT JOIN \`providers\` ON \`claims\`.\`provider_id\` = \`providers\`.\`id\`\nLEFT JOIN \`enrollees\` ON \`claims\`.\`enrollee_id\` = \`enrollees\`.\`id\`\nLEFT JOIN \`claim_items\` ON \`claims\`.\`id\` = \`claim_items\`.\`claim_id\`${w.length?"\nWHERE\n"+w.join("\n  AND "):""}\nGROUP BY \`claims\`.\`id\`\nORDER BY \`claims\`.\`encounter_date\` DESC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
    claim_count: { name: "Claim Count", desc: "Count of claims with filters", heavy: false,
      filters: ["hmo_id","date_range","date_field","provider_status","hmo_status"],
      build: (f) => {
        let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`claims\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(isNum(f.hmo_status)) w.push(`  \`claims\`.\`hmo_status\` = ${Number(f.hmo_status)}`);
        if(isNum(f.provider_status)) w.push(`  \`claims\`.\`provider_status\` = ${Number(f.provider_status)}`);
        const df=f.date_field||"submitted_at";
        if(f.date_from) w.push(`  \`claims\`.\`${esc(df)}\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`claims\`.\`${esc(df)}\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `-- Aggregate: no LIMIT needed\nSELECT\n  COUNT(DISTINCT \`claims\`.\`id\`) AS \`claim_count\`\nFROM \`claims\`${w.length?"\nWHERE\n"+w.join("\n  AND "):""};`;
      }
    },
    claims_status_breakdown: { name: "Status Breakdown", desc: "Claims grouped by hmo_status with amounts", heavy: false,
      filters: ["hmo_id","date_range","date_field"],
      build: (f) => {
        let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`claims\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        const df=f.date_field||"created_at";
        if(f.date_from) w.push(`  \`claims\`.\`${esc(df)}\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`claims\`.\`${esc(df)}\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `-- hmo_status: -1=Rejected, 0=Pending, 1=Approved\nSELECT\n  \`hmo_status\`,\n  COUNT(*) AS \`total\`,\n  SUM(\`approved_amount\`) AS \`total_approved_amount\`,\n  COUNT(\`vetted_at\`) AS \`vetted_count\`\nFROM \`claims\`${w.length?"\nWHERE\n"+w.join("\n  AND "):""}\nGROUP BY \`hmo_status\`\nORDER BY \`hmo_status\`;`;
      }
    },
    todays_claims: { name: "Today's Claims", desc: "Claims created today for a specific HMO", heavy: true,
      filters: ["hmo_id"],
      build: (f, lim) => {
        let w=[`  \`c\`.\`created_at\` >= CURDATE()`,`  \`c\`.\`created_at\` < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`c\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        return `SELECT\n  \`c\`.\`id\`,\n  \`c\`.\`hmo_id\`,\n  \`p\`.\`name\` AS \`provider_name\`,\n  CONCAT(\`e\`.\`firstname\`, ' ', \`e\`.\`lastname\`) AS \`enrollee_name\`,\n  \`c\`.\`encounter_date\`,\n  \`c\`.\`total_amount\` AS \`amount_submitted\`,\n  \`c\`.\`approved_amount\` AS \`amount_approved\`,\n  \`c\`.\`submitted_at\`,\n  \`c\`.\`provider_status\`,\n  \`c\`.\`hmo_status\`\nFROM \`claims\` \`c\`\nJOIN \`providers\` \`p\` ON \`c\`.\`provider_id\` = \`p\`.\`id\`\nJOIN \`enrollees\` \`e\` ON \`c\`.\`enrollee_id\` = \`e\`.\`id\`\nWHERE\n${w.join("\n  AND ")}\nORDER BY \`c\`.\`created_at\` DESC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
  }},
  claims_erp: { name: "Claims ERP/ID", icon: "🔗", desc: "Lookup and validate ERP IDs for reconciliation", templates: {
    erp_range: { name: "ERP ID Range", desc: "First and last ERP IDs in a date range", heavy: false,
      filters: ["hmo_id","date_range","erp_prefix"],
      build: (f) => {
        const px=esc(f.erp_prefix||"UG"); let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`hmo_id\` = ${Number(f.hmo_id)}`);
        if(f.date_from) w.push(`  \`encounter_date\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`encounter_date\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        w.push(`  \`hmo_erp_id\` LIKE '${px}%'`);
        return `SELECT\n  CONCAT('${px}', MIN(CAST(SUBSTRING(\`hmo_erp_id\`, ${px.length+1}) AS UNSIGNED))) AS \`first_erp_id\`,\n  CONCAT('${px}', MAX(CAST(SUBSTRING(\`hmo_erp_id\`, ${px.length+1}) AS UNSIGNED))) AS \`last_erp_id\`\nFROM \`claims\`\nWHERE\n${w.join("\n  AND ")};`;
      }
    },
    erp_detail_list: { name: "ERP Detail List", desc: "Claims with ERP IDs sorted chronologically", heavy: true,
      filters: ["hmo_id","date_range","erp_prefix"],
      build: (f, lim) => {
        const px=esc(f.erp_prefix||"UG"); let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`c\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(f.date_from) w.push(`  \`c\`.\`encounter_date\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`c\`.\`encounter_date\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        w.push(`  \`c\`.\`hmo_erp_id\` LIKE '${px}%'`);
        return `SELECT\n  \`c\`.\`hmo_erp_id\`,\n  \`c\`.\`encounter_date\`,\n  CONCAT(\`e\`.\`firstname\`, ' ', \`e\`.\`lastname\`) AS \`enrollee_name\`,\n  \`e\`.\`insurance_no\`,\n  \`p\`.\`name\` AS \`provider_name\`,\n  \`c\`.\`total_amount\`\nFROM \`claims\` \`c\`\nJOIN \`enrollees\` \`e\` ON \`e\`.\`id\` = \`c\`.\`enrollee_id\`\nJOIN \`providers\` \`p\` ON \`p\`.\`id\` = \`c\`.\`provider_id\`\nWHERE\n${w.join("\n  AND ")}\nORDER BY \`c\`.\`encounter_date\` ASC, CAST(SUBSTRING(\`c\`.\`hmo_erp_id\`, ${px.length+1}) AS UNSIGNED) ASC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
  }},
  tariff_counts: { name: "Tariff Analysis", icon: "💰", desc: "Analyze tariff mappings, gaps, and counts", templates: {
    unflagged_by_hmo: { name: "Unflagged Mapped by HMO", desc: "Count unflagged, mapped tariffs per HMO", heavy: false,
      filters: ["care_type_medication"],
      build: (f) => {
        let extra="";
        if(f.care_type_medication) extra=`\n  AND \`c\`.\`type_id\` = 1\n  AND \`pt\`.\`care_variation_id\` IS NULL`;
        return `SELECT\n  \`h\`.\`name\` AS \`hmo_name\`,\n  COUNT(DISTINCT \`pt\`.\`id\`) AS \`total_unflagged_mapped\`\nFROM \`provider_tariffs\` \`pt\`\nJOIN \`hmos\` \`h\` ON \`pt\`.\`hmo_id\` = \`h\`.\`id\`${f.care_type_medication?"\nJOIN `cares` `c` ON `pt`.`care_id` = `c`.`id`":""}\nWHERE \`pt\`.\`care_id\` IS NOT NULL\n  AND \`pt\`.\`flagged_as_correct_at\` IS NULL${extra}\nGROUP BY \`h\`.\`id\`, \`h\`.\`name\`\nORDER BY \`total_unflagged_mapped\` DESC;`;
      }
    },
    unmapped_by_hmo: { name: "Unmapped by HMO", desc: "Count unmapped, unflagged tariffs per HMO", heavy: false, filters: [],
      build: () => `SELECT\n  \`h\`.\`name\` AS \`hmo_name\`,\n  COUNT(DISTINCT \`pt\`.\`id\`) AS \`total_unmapped_unflagged\`\nFROM \`provider_tariffs\` \`pt\`\nJOIN \`hmos\` \`h\` ON \`pt\`.\`hmo_id\` = \`h\`.\`id\`\nWHERE \`pt\`.\`care_id\` IS NULL\n  AND \`pt\`.\`flagged_as_correct_at\` IS NULL\nGROUP BY \`h\`.\`id\`, \`h\`.\`name\`\nORDER BY \`total_unmapped_unflagged\` DESC;`
    },
    new_tariffs_today: { name: "New Tariffs Today", desc: "Count of new tariffs created today", heavy: false, filters: ["hmo_id"],
      build: (f) => {
        let w=[`  \`pt\`.\`created_at\` >= CURDATE()`,`  \`pt\`.\`created_at\` < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`pt\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        return `SELECT\n  COUNT(DISTINCT \`pt\`.\`id\`) AS \`total_new_provider_tariffs_today\`\nFROM \`provider_tariffs\` \`pt\`\nWHERE\n${w.join("\n  AND ")};`;
      }
    },
  }},
  tariff_exports: { name: "Tariff Exports", icon: "📦", desc: "Export tariff data with care, provider and HMO details", templates: {
    tariff_full_export: { name: "Full Tariff Export", desc: "Tariffs with HMO, provider, care details", heavy: true,
      filters: ["hmo_id","date_range","date_field","flagged_status","care_type_medication","variation_filter"],
      build: (f, lim) => {
        let w=[];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`pt\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(f.flagged_status==="unflagged") w.push("  `pt`.`flagged_as_correct_at` IS NULL");
        if(f.flagged_status==="flagged") w.push("  `pt`.`flagged_as_correct_at` IS NOT NULL");
        if(f.care_type_medication) w.push("  `c`.`type_id` = 1");
        if(f.variation_filter==="with") w.push("  `pt`.`care_variation_id` IS NOT NULL");
        if(f.variation_filter==="without") w.push("  `pt`.`care_variation_id` IS NULL");
        w.push("  `pt`.`care_id` IS NOT NULL");
        const df=f.date_field||"created_at";
        if(f.date_from) w.push(`  \`pt\`.\`${esc(df)}\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`pt\`.\`${esc(df)}\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `SELECT\n  \`pt\`.\`id\`,\n  \`pt\`.\`care_id\`,\n  \`h\`.\`name\` AS \`hmo_name\`,\n  \`p\`.\`name\` AS \`provider_name\`,\n  \`c\`.\`name\` AS \`care_name\`,\n  \`pt\`.\`desc\`,\n  \`pt\`.\`amount\`,\n  \`pt\`.\`created_at\`\nFROM \`provider_tariffs\` \`pt\`\nJOIN \`cares\` \`c\` ON \`pt\`.\`care_id\` = \`c\`.\`id\`\nJOIN \`hmos\` \`h\` ON \`pt\`.\`hmo_id\` = \`h\`.\`id\`\nLEFT JOIN \`providers\` \`p\` ON \`pt\`.\`provider_id\` = \`p\`.\`id\`\nWHERE\n${w.join("\n  AND ")}\nORDER BY \`pt\`.\`created_at\` DESC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
    tariff_with_variations: { name: "Tariffs + Variations", desc: "Medication tariffs with strength and drug form", heavy: true,
      filters: ["hmo_id","date_range","flagged_status"],
      build: (f, lim) => {
        let w=["  `c`.`type_id` = 1"];
        if(isNum(f.hmo_id)&&f.hmo_id!=="0") w.push(`  \`pt\`.\`hmo_id\` = ${Number(f.hmo_id)}`);
        if(f.flagged_status==="unflagged") w.push("  `pt`.`flagged_as_correct_at` IS NULL");
        if(f.date_from) w.push(`  \`pt\`.\`created_at\` >= '${esc(f.date_from)}'`);
        if(f.date_to) w.push(`  \`pt\`.\`created_at\` < DATE_ADD('${esc(f.date_to)}', INTERVAL 1 DAY)`);
        return `SELECT\n  \`pt\`.\`id\`,\n  \`pt\`.\`care_id\`,\n  \`c\`.\`name\` AS \`care_name\`,\n  \`h\`.\`name\` AS \`hmo_name\`,\n  JSON_UNQUOTE(JSON_EXTRACT(\`cv\`.\`meta\`, '$.strength')) AS \`strength\`,\n  \`df\`.\`name\` AS \`drug_form\`,\n  \`pt\`.\`amount\`,\n  \`pt\`.\`desc\`,\n  \`pt\`.\`care_variation_id\`,\n  \`pt\`.\`created_at\`\nFROM \`provider_tariffs\` \`pt\`\nJOIN \`cares\` \`c\` ON \`pt\`.\`care_id\` = \`c\`.\`id\`\nJOIN \`hmos\` \`h\` ON \`pt\`.\`hmo_id\` = \`h\`.\`id\`\nLEFT JOIN \`care_variations\` \`cv\` ON \`pt\`.\`care_variation_id\` = \`cv\`.\`id\`\nLEFT JOIN \`drug_forms\` \`df\` ON \`df\`.\`id\` = CAST(JSON_UNQUOTE(JSON_EXTRACT(\`cv\`.\`meta\`, '$.drug_form_id')) AS UNSIGNED)\nWHERE\n${w.join("\n  AND ")}\nORDER BY \`pt\`.\`created_at\` DESC${lim?`\nLIMIT ${lim}`:""};`;
      }
    },
  }},
  cares_analysis: { name: "Cares / CVE", icon: "🧬", desc: "Care catalog analysis and V1/V2 migration status", templates: {
    v1_cares: { name: "Non-V2 Cares", desc: "All cares not yet on CVE version 2", heavy: false, filters: [],
      build: (f, lim) => `SELECT \`id\`, \`name\`, \`type\`, \`active\`, \`type_id\`, \`cve_version\`\nFROM \`cares\`\nWHERE \`cve_version\` IS NULL OR \`cve_version\` <> 2\nORDER BY \`name\`${lim?`\nLIMIT ${lim}`:""};`
    },
    cve_version_summary: { name: "CVE Version Summary", desc: "Count of cares grouped by CVE version", heavy: false, filters: [],
      build: () => `SELECT \`cve_version\`, COUNT(*) AS \`total_cares\`\nFROM \`cares\`\nGROUP BY \`cve_version\`\nORDER BY \`cve_version\`;`
    },
  }},
  reference: { name: "Reference", icon: "🔍", desc: "Quick lookups for status codes and system values", templates: {
    distinct_hmo_status: { name: "Distinct HMO Statuses", desc: "All unique hmo_status values", heavy: false, filters: [],
      build: () => `SELECT DISTINCT \`hmo_status\` FROM \`claims\` ORDER BY \`hmo_status\`;`
    },
    distinct_provider_status: { name: "Provider Status Breakdown", desc: "Provider status values with counts", heavy: false, filters: [],
      build: () => `SELECT \`provider_status\`, COUNT(*) AS \`total\`\nFROM \`claims\`\nGROUP BY \`provider_status\`\nORDER BY \`provider_status\`;`
    },
    item_status_breakdown: { name: "Claim Item Status", desc: "All item_status values with counts", heavy: false, filters: [],
      build: () => `SELECT \`item_status\`, COUNT(*) AS \`total\`\nFROM \`claim_items\`\nGROUP BY \`item_status\`\nORDER BY \`item_status\`;`
    },
  }},
};


/* ═══════════════════════════════════════════════════════════
   SHARED STYLES & MICRO-COMPONENTS
   ═══════════════════════════════════════════════════════════ */
const inputS = { padding:"9px 12px", border:`1.5px solid ${C.border}`, borderRadius:6, fontSize:13, fontFamily:"DM Sans,sans-serif", color:C.text, background:C.elevated, outline:"none", width:"100%", boxSizing:"border-box" };
const selectS = { ...inputS, cursor:"pointer" };
const btnSmall = { padding:"5px 10px", border:`1px solid ${C.border}`, borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background:C.elevated, color:C.sub, fontFamily:"DM Sans,sans-serif" };

function Badge({ children, color = C.accent, bg }) {
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, background:bg||color+"22", color }}>{children}</span>;
}

/* Helper description - subtle, newbie-friendly */
function Hint({ children }) {
  return <div style={{ fontSize:11, color:C.muted, lineHeight:1.4, marginBottom:8, fontStyle:"italic" }}>{children}</div>;
}

/* Section label with consistent styling */
function SectionLabel({ icon, label }) {
  return <div style={{ fontSize:11, fontWeight:600, color:C.sub, textTransform:"uppercase", letterSpacing:".05em", marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>{icon} {label}</div>;
}


/* ═══════════════════════════════════════════════════════════
   FILTER PANEL (for template queries)
   ═══════════════════════════════════════════════════════════ */
function FilterPanel({ filters: fl, values: v, onChange }) {
  const [customHmo, setCustomHmo] = useState("");
  if (!fl || !fl.length) return <div style={{ padding:18, color:C.muted, fontSize:13, fontStyle:"italic", textAlign:"center" }}>No filters needed — runs as-is ✅</div>;
  const L = (label) => <label style={{ fontSize:11, fontWeight:600, color:C.sub, textTransform:"uppercase", letterSpacing:".05em" }}>{label}</label>;
  return (
    <div style={{ padding:18, display:"flex", flexDirection:"column", gap:14 }}>
      <Hint>Set your filters below. The SQL on the right updates automatically as you change values.</Hint>
      {fl.includes("hmo_id") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("HMO Partner")}
        <select value={v.hmo_id||""} onChange={e=>{onChange("hmo_id",e.target.value);if(e.target.value!=="0")setCustomHmo("");}} style={selectS}>
          <option value="">All HMOs</option>
          {HMO_LIST.map(h=><option key={h.id} value={h.id}>{h.name}{h.id?` (${h.id})`:""}</option>)}
        </select>
        {v.hmo_id==="0" && <input type="number" min="1" placeholder="Enter HMO ID..." value={customHmo} onChange={e=>{setCustomHmo(e.target.value);if(e.target.value)onChange("hmo_id",e.target.value);}} style={{...inputS,marginTop:4}} />}
      </div>}
      {fl.includes("date_field") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("Date Field")}
        <select value={v.date_field||"created_at"} onChange={e=>onChange("date_field",e.target.value)} style={selectS}>
          <option value="created_at">Created At</option><option value="encounter_date">Encounter Date</option>
          <option value="submitted_at">Submitted At</option><option value="vetted_at">Vetted At</option><option value="paid_at">Paid At</option>
        </select>
      </div>}
      {fl.includes("date_range") && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>{L("From")}<input type="date" value={v.date_from||""} onChange={e=>onChange("date_from",e.target.value)} style={inputS}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>{L("To")}<input type="date" value={v.date_to||""} onChange={e=>onChange("date_to",e.target.value)} style={inputS}/></div>
      </div>}
      {fl.includes("hmo_status") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("HMO Status")}
        <select value={v.hmo_status??""} onChange={e=>onChange("hmo_status",e.target.value)} style={selectS}>
          <option value="">All</option>{Object.entries(STATUS_MAPS.hmo_status.values).map(([k,l])=><option key={k} value={k}>{l} ({k})</option>)}
        </select>
      </div>}
      {fl.includes("provider_status") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("Provider Status")}
        <select value={v.provider_status??""} onChange={e=>onChange("provider_status",e.target.value)} style={selectS}>
          <option value="">All</option>{Object.entries(STATUS_MAPS.provider_status.values).map(([k,l])=><option key={k} value={k}>{l} ({k})</option>)}
        </select>
      </div>}
      {fl.includes("provider_name") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("Provider Name")}<input type="text" placeholder="e.g., General Hospital..." value={v.provider_name||""} onChange={e=>onChange("provider_name",e.target.value)} style={inputS}/>
      </div>}
      {fl.includes("erp_prefix") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("ERP Prefix")}<input type="text" maxLength={4} placeholder="UG" value={v.erp_prefix||""} onChange={e=>onChange("erp_prefix",e.target.value.replace(/[^A-Za-z]/g,"").toUpperCase())} style={inputS}/>
      </div>}
      {fl.includes("flagged_status") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("Flagged Status")}
        <select value={v.flagged_status||""} onChange={e=>onChange("flagged_status",e.target.value)} style={selectS}>
          <option value="">All</option><option value="unflagged">Unflagged</option><option value="flagged">Flagged</option>
        </select>
      </div>}
      {fl.includes("variation_filter") && <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {L("Variation")}
        <select value={v.variation_filter||""} onChange={e=>onChange("variation_filter",e.target.value)} style={selectS}>
          <option value="">All</option><option value="with">With Variation</option><option value="without">Without</option>
        </select>
      </div>}
      {fl.includes("vetted_only") && <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.text}}>
        <input type="checkbox" checked={v.vetted_only||false} onChange={e=>onChange("vetted_only",e.target.checked)} style={{accentColor:C.accent,width:16,height:16}}/>Only vetted claims
      </label>}
      {fl.includes("has_unmatched_tariff") && <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.text}}>
        <input type="checkbox" checked={v.has_unmatched_tariff||false} onChange={e=>onChange("has_unmatched_tariff",e.target.checked)} style={{accentColor:C.accent,width:16,height:16}}/>Has unmatched tariff
      </label>}
      {fl.includes("care_type_medication") && <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.text}}>
        <input type="checkbox" checked={v.care_type_medication||false} onChange={e=>onChange("care_type_medication",e.target.checked)} style={{accentColor:C.accent,width:16,height:16}}/>Medications only
      </label>}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   AI ASSISTANT
   ═══════════════════════════════════════════════════════════ */
function AIAssistant({ onResult }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const examples = [
    "Show me all approved claims for UAP Old Mutual in January 2026 with provider and enrollee details",
    "Count unflagged medication tariffs without variations grouped by HMO",
    "List today's new provider tariffs for hmo_id 73 with care names",
    "Find all claims with unmatched tariffs submitted in the last 30 days",
    "Show enrollee details and claim amounts for rejected claims in August 2025",
  ];
  const go = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/generate-sql", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({prompt:prompt.trim()}) });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.sql) onResult(data.sql); else setError("No SQL generated.");
    } catch(e) { setError("Failed to generate. Try again."); console.error(e); }
    setLoading(false);
  };
  return (
    <div style={{ padding:18, display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ background:`linear-gradient(135deg, ${C.purple}15, ${C.accent}10)`, borderRadius:10, padding:18, border:`1.5px solid ${C.purple}40` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <span style={{fontSize:22}}>🤖</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:C.text}}>AI Query Generator</div>
            <div style={{fontSize:12,color:C.sub}}>Describe what data you need in plain English. The AI will generate the correct MySQL query.</div>
          </div>
          <Badge color={C.purple}>Claude</Badge>
        </div>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))go();}}
          placeholder="e.g., Show me all approved claims for UAP in July 2025 with enrollee names and amounts..."
          style={{ ...inputS, minHeight:90, resize:"vertical", lineHeight:1.6, border:`1.5px solid ${C.purple}50`, marginTop:10 }} />
        <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
          <button onClick={go} disabled={loading||!prompt.trim()} style={{
            padding:"10px 22px", background:loading?C.muted:C.accent, color:C.bg, border:"none", borderRadius:6,
            fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer", fontFamily:"DM Sans,sans-serif",
            opacity:!prompt.trim()&&!loading?.5:1,
          }}>{loading?"⏳ Generating...":"✨ Generate SQL"}</button>
          <span style={{fontSize:11,color:C.muted}}>⌘+Enter</span>
        </div>
        {error && <div style={{marginTop:10,padding:"8px 12px",background:C.danger+"22",borderRadius:6,fontSize:12,color:C.danger}}>{error}</div>}
      </div>
      <div>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".05em",marginBottom:6}}>💡 Try an example — click to fill the box above</div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {examples.map((ex,i)=><button key={i} onClick={()=>setPrompt(ex)} style={{
            textAlign:"left",padding:"8px 12px",background:C.elevated,border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,color:C.sub,cursor:"pointer",lineHeight:1.4,
          }} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.color=C.accent;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.sub;}}>"{ex}"</button>)}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   CUSTOM QUERY BUILDER (with date range + helper text)
   ═══════════════════════════════════════════════════════════ */
function CustomBuilder({ onSQL }) {
  const [baseTable, setBaseTable] = useState("claims");
  const [selectedCols, setSelectedCols] = useState(["id","hmo_id","total_amount","approved_amount","hmo_status","created_at"]);
  const [joins, setJoins] = useState([]);
  const [wheres, setWheres] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateCol, setDateCol] = useState("created_at");
  const [orderCol, setOrderCol] = useState("created_at");
  const [orderDir, setOrderDir] = useState("DESC");
  const [limitVal, setLimitVal] = useState("1000");

  const bt = TABLES[baseTable];
  const alias = bt.alias;
  const availableJoins = JOINS[baseTable] || {};

  // Date-type columns for current table
  const dateCols = bt.cols.filter(c => c.includes("_at") || c.includes("date") || c === "birthdate");

  // All available columns (base + joined)
  const allCols = useMemo(() => {
    let cols = bt.cols.map(c => ({ table: baseTable, alias, col: c, display: `${alias}.${c}` }));
    joins.forEach(j => {
      const jt = TABLES[j.table];
      if (jt) jt.cols.forEach(c => cols.push({ table: j.table, alias: jt.alias, col: c, display: `${jt.alias}.${c}` }));
    });
    return cols;
  }, [baseTable, bt, alias, joins]);

  const toggleCol = (col) => setSelectedCols(p => p.includes(col) ? p.filter(c => c !== col) : [...p, col]);

  const addJoin = (table) => {
    if (joins.find(j => j.table === table)) return;
    setJoins(p => [...p, { table, type: "LEFT JOIN", on: availableJoins[table].on }]);
  };
  const removeJoin = (table) => {
    setJoins(p => p.filter(j => j.table !== table));
    const jAlias = TABLES[table]?.alias;
    setSelectedCols(p => p.filter(c => !c.startsWith(jAlias + ".")));
  };

  const addWhere = () => setWheres(p => [...p, { col: `${alias}.id`, op: "=", val: "" }]);
  const updateWhere = (i, field, val) => setWheres(p => p.map((w, idx) => idx === i ? { ...w, [field]: val } : w));
  const removeWhere = (i) => setWheres(p => p.filter((_, idx) => idx !== i));

  // Build SQL
  const sql = useMemo(() => {
    const selectCols = selectedCols.length > 0
      ? selectedCols.map(c => c.includes(".") ? `  \`${c.split(".")[0]}\`.\`${c.split(".")[1]}\`` : `  \`${alias}\`.\`${c}\``).join(",\n")
      : `  \`${alias}\`.*`;
    let from = `FROM \`${baseTable}\` \`${alias}\``;
    const joinLines = joins.map(j => `${j.type} \`${j.table}\` \`${TABLES[j.table].alias}\` ON ${j.on}`).join("\n");

    // Combine manual WHERE + date range
    const whereLines = [];
    wheres.filter(w => w.val || w.op === "IS NULL" || w.op === "IS NOT NULL").forEach(w => {
      if (w.op === "IS NULL") whereLines.push(`  ${w.col} IS NULL`);
      else if (w.op === "IS NOT NULL") whereLines.push(`  ${w.col} IS NOT NULL`);
      else if (w.op === "IN") whereLines.push(`  ${w.col} IN (${w.val})`);
      else if (w.op === "LIKE") whereLines.push(`  ${w.col} LIKE '${esc(w.val)}'`);
      else whereLines.push(`  ${w.col} ${w.op} '${esc(w.val)}'`);
    });
    if (dateFrom) whereLines.push(`  \`${alias}\`.\`${dateCol}\` >= '${esc(dateFrom)}'`);
    if (dateTo) whereLines.push(`  \`${alias}\`.\`${dateCol}\` < DATE_ADD('${esc(dateTo)}', INTERVAL 1 DAY)`);

    let q = `SELECT\n${selectCols}\n${from}`;
    if (joinLines) q += `\n${joinLines}`;
    if (whereLines.length) q += `\nWHERE\n${whereLines.join("\n  AND ")}`;
    if (orderCol) q += `\nORDER BY \`${alias}\`.\`${orderCol}\` ${orderDir}`;
    if (limitVal && limitVal !== "0" && limitVal !== "") q += `\nLIMIT ${limitVal}`;
    q += ";";
    return q;
  }, [baseTable, alias, selectedCols, joins, wheres, dateFrom, dateTo, dateCol, orderCol, orderDir, limitVal]);

  // Stable callback
  const stableOnSQL = useCallback(onSQL, []);
  useEffect(() => { stableOnSQL(sql); }, [sql, stableOnSQL]);

  return (
    <div style={{ padding:18, display:"flex", flexDirection:"column", gap:16, maxHeight:"calc(100vh - 200px)", overflowY:"auto" }}>
      {/* Intro */}
      <div style={{ padding:"12px 14px", background:`${C.blue}10`, borderRadius:8, border:`1px solid ${C.blue}30` }}>
        <div style={{fontSize:12,color:C.blue,fontWeight:600,marginBottom:4}}>🔨 How to use the Custom Builder</div>
        <div style={{fontSize:11.5,color:C.sub,lineHeight:1.5}}>
          Build a query step by step: choose a table, pick columns you want to see, connect related tables with joins, add filters, then copy the generated SQL to Metabase.
        </div>
      </div>

      {/* 1. Base Table */}
      <div>
        <SectionLabel icon="📦" label="Step 1 — Pick a table" />
        <Hint>This is the main table your query reads from. Start with "claims" for most use cases.</Hint>
        <select value={baseTable} onChange={e => { setBaseTable(e.target.value); setSelectedCols(["id"]); setJoins([]); setWheres([]); setDateFrom(""); setDateTo(""); setDateCol("created_at"); setOrderCol("created_at"); }} style={selectS}>
          {Object.entries(TABLES).map(([k, t]) => <option key={k} value={k}>{t.label} ({t.size})</option>)}
        </select>
      </div>

      {/* 2. Joins */}
      <div>
        <SectionLabel icon="🔗" label="Step 2 — Connect related tables (optional)" />
        <Hint>Click a table to JOIN it. This lets you pull columns from that table too. Green = connected.</Hint>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {Object.entries(availableJoins).map(([table, info]) => {
            const joined = joins.find(j => j.table === table);
            return (
              <button key={table} onClick={() => joined ? removeJoin(table) : addJoin(table)} style={{
                padding:"6px 12px", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer",
                background: joined ? C.accent+"22" : C.elevated, color: joined ? C.accent : C.sub,
                border: `1.5px solid ${joined ? C.accent : C.border}`, fontFamily:"DM Sans,sans-serif", transition:"all .15s",
              }}>
                {joined ? "✓ " : "+ "}{TABLES[table]?.label}
                <span style={{ fontSize:10, color:C.muted, marginLeft:4 }}>({info.label})</span>
              </button>
            );
          })}
          {Object.keys(availableJoins).length === 0 && <span style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>No predefined joins for this table</span>}
        </div>
      </div>

      {/* 3. Columns */}
      <div>
        <SectionLabel icon="📝" label={`Step 3 — Choose columns from ${bt.label}`} />
        <Hint>Tick the columns you want in your results. Use "All" to select everything, or "Reset" to start over.</Hint>
        <div style={{ display:"flex", gap:6, marginBottom:6 }}>
          <button onClick={() => setSelectedCols(bt.cols.map(c => c))} style={{...btnSmall, color:C.accent, borderColor:C.accent}}>Select All</button>
          <button onClick={() => setSelectedCols(["id"])} style={btnSmall}>Reset</button>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:4, maxHeight:100, overflowY:"auto", padding:4 }}>
          {bt.cols.map(col => (
            <label key={col} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:4, fontSize:11, cursor:"pointer",
              background: selectedCols.includes(col) ? C.accent+"18" : C.elevated,
              border: `1px solid ${selectedCols.includes(col) ? C.accent+"60" : C.border}`,
              color: selectedCols.includes(col) ? C.accent : C.sub, fontFamily:"JetBrains Mono,monospace",
            }}>
              <input type="checkbox" checked={selectedCols.includes(col)} onChange={() => toggleCol(col)} style={{width:12,height:12,accentColor:C.accent}} />
              {col}
            </label>
          ))}
        </div>
        {/* Joined table columns */}
        {joins.map(j => {
          const jt = TABLES[j.table]; if (!jt) return null;
          return (
            <div key={j.table} style={{ marginTop:10 }}>
              <div style={{fontSize:11,fontWeight:600,color:C.blue,marginBottom:4}}>+ {jt.label} columns</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4, maxHeight:70, overflowY:"auto", padding:4 }}>
                {jt.cols.map(col => {
                  const full = `${jt.alias}.${col}`;
                  return (
                    <label key={full} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:4, fontSize:11, cursor:"pointer",
                      background: selectedCols.includes(full) ? C.blue+"18" : C.elevated,
                      border: `1px solid ${selectedCols.includes(full) ? C.blue+"60" : C.border}`,
                      color: selectedCols.includes(full) ? C.blue : C.sub, fontFamily:"JetBrains Mono,monospace",
                    }}>
                      <input type="checkbox" checked={selectedCols.includes(full)} onChange={() => toggleCol(full)} style={{width:12,height:12,accentColor:C.blue}} />
                      {col}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Date Range */}
      {dateCols.length > 0 && (
        <div>
          <SectionLabel icon="📅" label="Step 4 — Date range (optional)" />
          <Hint>Filter results to a specific time period. Pick which date column to filter on, then set from/to dates.</Hint>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <select value={dateCol} onChange={e => setDateCol(e.target.value)} style={{...selectS, fontSize:12}}>
              {dateCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:10,fontWeight:600,color:C.muted}}>FROM</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputS} />
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:10,fontWeight:600,color:C.muted}}>TO</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputS} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. WHERE */}
      <div>
        <SectionLabel icon="🎯" label="Step 5 — Additional conditions (optional)" />
        <Hint>Add WHERE filters like "hmo_id = 73" or "hmo_status = 1". Each row becomes an AND condition.</Hint>
        {wheres.map((w, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr auto", gap:6, marginBottom:6, alignItems:"center" }}>
            <select value={w.col} onChange={e => updateWhere(i, "col", e.target.value)} style={{...selectS,fontSize:11,padding:"6px 8px",fontFamily:"JetBrains Mono,monospace"}}>
              {allCols.map(c => <option key={c.display} value={c.display}>{c.display}</option>)}
            </select>
            <select value={w.op} onChange={e => updateWhere(i, "op", e.target.value)} style={{...selectS,fontSize:11,padding:"6px 8px",width:"auto"}}>
              {OPS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {(w.op !== "IS NULL" && w.op !== "IS NOT NULL") ? (
              <input value={w.val} onChange={e => updateWhere(i, "val", e.target.value)} placeholder="value..." style={{...inputS,fontSize:11,padding:"6px 8px"}} />
            ) : <div />}
            <button onClick={() => removeWhere(i)} style={{...btnSmall, color:C.danger, borderColor:C.danger, padding:"4px 8px"}}>✕</button>
          </div>
        ))}
        <button onClick={addWhere} style={{...btnSmall, color:C.accent, borderColor:C.accent}}>+ Add condition</button>
      </div>

      {/* 6. ORDER BY + LIMIT */}
      <div>
        <SectionLabel icon="↕" label="Step 6 — Sort & limit results" />
        <Hint>ORDER BY sorts your results. LIMIT caps how many rows are returned (1000 recommended for safety).</Hint>
        <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, alignItems:"end" }}>
          <div>
            <label style={{fontSize:10,fontWeight:600,color:C.muted}}>ORDER BY</label>
            <select value={orderCol} onChange={e => setOrderCol(e.target.value)} style={{...selectS,fontSize:12}}>
              <option value="">None</option>
              {bt.cols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,fontWeight:600,color:C.muted}}>Direction</label>
            <select value={orderDir} onChange={e => setOrderDir(e.target.value)} style={{...selectS,fontSize:12,width:100}}>
              <option value="DESC">DESC ↓</option><option value="ASC">ASC ↑</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:10,fontWeight:600,color:C.muted}}>LIMIT</label>
            <input type="number" value={limitVal} onChange={e => setLimitVal(e.target.value)} style={{...inputS,fontSize:12,width:90}} />
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   SQL DISPLAY
   ═══════════════════════════════════════════════════════════ */
function SQLDisplay({ sql, name, limitOn, onToggle }) {
  const [copied, setCopied] = useState(false);
  const lines = sql.split("\n").length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(sql); } catch { const t=document.createElement("textarea");t.value=sql;document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t); }
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  };
  return (
    <div style={{ background:C.code.bg, borderRadius:12, border:`1.5px solid ${C.border}`, overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", background:"#0A0E18", borderBottom:`1px solid ${C.border}`, flexWrap:"wrap", gap:8 }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:6}}><div style={{width:12,height:12,borderRadius:"50%",background:C.danger}}/><div style={{width:12,height:12,borderRadius:"50%",background:C.warn}}/><div style={{width:12,height:12,borderRadius:"50%",background:C.success}}/></div>
          <span style={{fontSize:12,color:C.muted,fontFamily:"JetBrains Mono,monospace"}}>{name||"query"}.sql</span>
          <span style={{fontSize:11,color:C.border,fontFamily:"JetBrains Mono,monospace"}}>({lines} lines)</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {onToggle && <button onClick={onToggle} style={{
            padding:"5px 12px", background:limitOn?C.success+"22":C.danger+"22", color:limitOn?C.success:C.danger,
            border:`1px solid ${limitOn?C.success:C.danger}`, borderRadius:6, fontSize:11, fontWeight:600, fontFamily:"JetBrains Mono,monospace", cursor:"pointer",
          }}>{limitOn?`LIMIT ${LIMIT} ✓`:"No LIMIT"}</button>}
          <button onClick={copy} style={{
            padding:"7px 18px", background:copied?C.success:C.accent, color:C.bg, border:"none", borderRadius:6,
            fontSize:12, fontWeight:700, fontFamily:"DM Sans,sans-serif", cursor:"pointer",
          }}>{copied?"✓ Copied!":"📋 Copy"}</button>
        </div>
      </div>
      <pre style={{ padding:"18px 20px", margin:0, fontFamily:"JetBrains Mono,monospace", fontSize:13, lineHeight:1.7, color:C.code.text, overflowX:"auto", overflowY:"auto", maxHeight:520, whiteSpace:"pre", tabSize:2 }} dangerouslySetInnerHTML={{__html:highlightSQL(sql)}} />
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   MAIN PAGE (no Sidebar — layout.js handles it now)
   ═══════════════════════════════════════════════════════════ */
export default function QueryBuilderPage() {
  const [activeCat, setActiveCat] = useState("ai_assistant");
  const [activeTpl, setActiveTpl] = useState(null);
  const [filters, setFilters] = useState({});
  const [aiSQL, setAiSQL] = useState("");
  const [customSQL, setCustomSQL] = useState("");
  const [limitOn, setLimitOn] = useState(true);

  const cat = CATS[activeCat];
  const tpl = activeTpl ? cat?.templates?.[activeTpl] : null;
  const isAI = activeCat === "ai_assistant";
  const isCustom = activeCat === "custom_builder";

  useEffect(() => { setActiveTpl(null); setFilters({}); setAiSQL(""); setCustomSQL("");
    if (!isAI && !isCustom) { const t=CATS[activeCat]?.templates; if(t){const f=Object.keys(t)[0]; if(f)setActiveTpl(f);} }
  }, [activeCat, isAI, isCustom]);
  useEffect(() => { setFilters({}); setLimitOn(true); }, [activeTpl]);

  const isH = activeTpl && HEAVY.has(activeTpl);
  const showToggle = !isAI && !isCustom && isH;
  const effLimit = showToggle && limitOn ? LIMIT : null;

  const sql = useMemo(() => {
    if (isAI) return aiSQL || "-- Use the AI assistant to generate a query\n-- Type what you need in the box on the left, then click Generate SQL";
    if (isCustom) return customSQL || "-- Pick a table and columns to build your query\n-- Your SQL will appear here as you make selections";
    if (tpl?.build) return tpl.build(filters, effLimit);
    return "-- Select a query template";
  }, [isAI, isCustom, aiSQL, customSQL, tpl, filters, effLimit]);

  const warning = useMemo(() => {
    if (isAI || isCustom || !activeTpl) return null;
    if (isExpensive(activeTpl, filters)) return "⚠️ No HMO or date filter — this may return millions of rows and be very slow.";
    if (isH && !limitOn) return "⚠️ LIMIT is off — large result set possible. Use with caution.";
    return null;
  }, [isAI, isCustom, activeTpl, filters, limitOn, isH]);

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"DM Sans,sans-serif" }}>
      {/* Header */}
      <div style={{ padding:"14px 24px", background:C.card, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚡</div>
          <div>
            <span style={{ fontSize:16, fontWeight:700 }}>Query Builder</span>
            <span style={{ fontSize:11, color:C.muted, marginLeft:8 }}>v3</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <Badge color={C.success}>Status Maps Confirmed</Badge>
          <Badge color={C.blue}>MySQL</Badge>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 24px" }}>
        {/* Category Tabs with descriptions */}
        <div style={{ display:"flex", gap:6, marginBottom:6, overflowX:"auto", paddingBottom:4 }}>
          {Object.entries(CATS).map(([key, c]) => (
            <button key={key} onClick={()=>setActiveCat(key)} style={{
              padding:"10px 16px", borderRadius:10,
              border:activeCat===key?`2px solid ${key==="custom_builder"?C.blue:C.accent}`:`1.5px solid ${C.border}`,
              background:activeCat===key?(key==="custom_builder"?C.blue:C.accent)+"15":C.card,
              cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"DM Sans,sans-serif",
              color:activeCat===key?(key==="custom_builder"?C.blue:C.accent):C.sub, whiteSpace:"nowrap",
            }}>{c.icon} {c.name}</button>
          ))}
        </div>
        {/* Active tab description */}
        <div style={{ fontSize:12, color:C.muted, marginBottom:16, paddingLeft:4 }}>{cat?.desc}</div>

        {/* Main Grid */}
        <div style={{ display:"grid", gridTemplateColumns: isCustom ? "420px 1fr" : "380px 1fr", gap:20, alignItems:"start" }}>
          {/* Left Panel */}
          <div style={{ background:C.card, borderRadius:12, border:`1.5px solid ${C.border}`, overflow:"hidden" }}>
            <div style={{ padding:"12px 18px", background:C.elevated, borderBottom:`1.5px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{fontSize:14}}>{isAI?"🤖":isCustom?"🔨":"🔧"}</span>
              <span style={{fontSize:14,fontWeight:600}}>{isAI?"AI Assistant":isCustom?"Custom Builder":"Filters"}</span>
              {!isAI && !isCustom && <button onClick={()=>setFilters({})} style={{marginLeft:"auto",...btnSmall}}>Reset</button>}
            </div>
            {isAI ? <AIAssistant onResult={setAiSQL}/> :
             isCustom ? <CustomBuilder onSQL={setCustomSQL}/> : <>
              {cat?.templates && Object.keys(cat.templates).length > 1 && (
                <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", flexDirection:"column", gap:6 }}>
                  <span style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".05em"}}>Choose a query type</span>
                  {Object.entries(cat.templates).map(([key,t])=>(
                    <button key={key} onClick={()=>setActiveTpl(key)} style={{
                      textAlign:"left",padding:"8px 12px",borderRadius:6,
                      border:activeTpl===key?`1.5px solid ${C.accent}`:`1px solid ${C.border}`,
                      background:activeTpl===key?C.accent+"10":C.card,cursor:"pointer",
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:13,fontWeight:600,color:activeTpl===key?C.accent:C.text}}>{t.name}</span>
                        {t.heavy && <Badge color={C.warn}>Heavy</Badge>}
                      </div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              <FilterPanel filters={tpl?.filters} values={filters} onChange={(k,v)=>setFilters(p=>({...p,[k]:v}))} />
            </>}
          </div>

          {/* Right Panel */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {warning && <div style={{padding:"10px 14px",background:C.warn+"15",border:`1.5px solid ${C.warn}40`,borderRadius:8,fontSize:12.5,color:C.warn}}>{warning}</div>}
            <SQLDisplay sql={sql} name={isAI?"ai_generated":isCustom?"custom_query":(activeTpl||"query")} limitOn={showToggle?limitOn:null} onToggle={showToggle?()=>setLimitOn(p=>!p):null} />

            {/* Quick Reference */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
              <div style={{padding:"14px 16px",borderRadius:10,background:C.card,border:`1.5px solid ${C.border}`}}>
                <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>How to use</div>
                <div style={{fontSize:12.5,color:C.sub,lineHeight:1.4}}>Copy → Metabase → New Question → Native Query → Run</div>
              </div>
              <div style={{padding:"14px 16px",borderRadius:10,background:C.success+"10",border:`1.5px solid ${C.success}30`}}>
                <div style={{fontSize:11,fontWeight:600,color:C.success,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>✅ HMO Status</div>
                <div style={{fontSize:12.5,color:C.success,lineHeight:1.4}}>-1=Rejected, 0=Pending, 1=Approved</div>
              </div>
              <div style={{padding:"14px 16px",borderRadius:10,background:C.blue+"10",border:`1.5px solid ${C.blue}30`}}>
                <div style={{fontSize:11,fontWeight:600,color:C.blue,textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>💡 Safety</div>
                <div style={{fontSize:12.5,color:C.blue,lineHeight:1.4}}>Heavy queries auto-add LIMIT 1000</div>
              </div>
            </div>

            {/* Status Reference */}
            <div style={{background:C.card,borderRadius:10,border:`1.5px solid ${C.border}`,padding:"16px 20px"}}>
              <div style={{fontSize:12,fontWeight:600,color:C.sub,textTransform:"uppercase",letterSpacing:".05em",marginBottom:12}}>🔑 Status Reference</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                {Object.entries(STATUS_MAPS).map(([k,m])=>(
                  <div key={k}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6}}>{m.label}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {Object.entries(m.values).map(([val,label])=>(
                        <span key={val} style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:500,background:C.elevated,color:C.sub,border:`1px solid ${C.border}`,fontFamily:"JetBrains Mono,monospace"}}>{val} = {label}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
