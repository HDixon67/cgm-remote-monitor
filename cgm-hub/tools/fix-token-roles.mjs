// Repair tool: make sure the "cgmhub" Nightscout subject (the CGM Hub token) has the roles it needs.
// Run as a one-off of the cgm-reminders job with REMINDERS_URL pointing here and FIX_MODE=list|fix.
// Prints subject names and roles only; never prints tokens or secrets. The token itself does not change.
import crypto from 'node:crypto';

const NS = (process.env.NIGHTSCOUT_INTERNAL_URL || 'http://sunset-cast:8080').replace(/\/+$/, '');
const MODE = process.env.FIX_MODE || 'list';
const NEEDED = (process.env.FIX_ROLES || 'readable careportal cgmhub-edit').split(/\s+/).filter(Boolean);
// custom role so CGM Hub can edit and delete saved logs (Nightscout has no built-in role for this)
const CUSTOM = { 'cgmhub-edit': ['api:treatments:update', 'api:treatments:delete'] };
const headers = { 'api-secret': crypto.createHash('sha1').update(process.env.API_SECRET || '').digest('hex'), Accept: 'application/json', 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const res = await fetch(NS + '/api/v2/authorization' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* empty */ }
  return { status: res.status, json };
};

const list = async () => {
  const s = await call('GET', '/subjects');
  console.log('subjects status', s.status);
  for (const x of s.json || []) console.log(' subject:', x.name, '| roles:', JSON.stringify(x.roles));
  const r = await call('GET', '/roles');
  console.log(' roles available:', (r.json || []).map((x) => x.name).join(', '));
  return s.json || [];
};

const subs = await list();
if (MODE === 'fix') {
  const have = ((await call('GET', '/roles')).json || []).map((x) => x.name);
  for (const name of NEEDED) {
    if (CUSTOM[name] && !have.includes(name)) {
      const c = await call('POST', '/roles', { name, permissions: CUSTOM[name], notes: 'CGM Hub: edit and delete logs' });
      console.log('created role', name, JSON.stringify(CUSTOM[name]), 'status', c.status);
    }
  }
  const s = subs.find((x) => String(x.name).toLowerCase() === 'cgmhub');
  if (!s) {
    const c = await call('POST', '/subjects', { name: 'cgmhub', roles: NEEDED, notes: 'CGM Hub app' });
    console.log('created cgmhub subject, status', c.status, '(a NEW token was made: copy it from Admin Tools)');
  } else {
    const roles = [...new Set([...(s.roles || []).filter((r) => r !== 'admin'), ...NEEDED])];
    const u = await call('PUT', '/subjects', { _id: s._id, name: s.name, roles, notes: s.notes || 'CGM Hub app' });
    console.log('updated cgmhub roles to', JSON.stringify(roles), 'status', u.status);
  }
  await list();
}
