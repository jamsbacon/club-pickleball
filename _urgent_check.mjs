import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(url, key);

const { data: tournaments } = await supabase.from('tournaments').select('*');
const acp = tournaments.find(t => t.name.includes('ACP 500'));
console.log('Torneo:', acp.name, '| match_duration_min:', acp.match_duration_min, '| break_min:', acp.break_min, '| daily_start:', acp.daily_start);

const { data: cats } = await supabase.from('categories').select('id, name, matches').eq('tournament_id', acp.id);

const byDayCourt = {};
let total = 0, withTime = 0, locked = 0, unlocked = 0;
cats.forEach(c => {
  (c.matches || []).forEach(m => {
    total++;
    if (m.day && m.time) withTime++;
    if (m.locked) locked++; else unlocked++;
    if (!m.day || !m.time || !m.courtId) return;
    const key = `${m.day}|${m.courtId}`;
    (byDayCourt[key] = byDayCourt[key] || []).push({ time: m.time, cat: c.name, locked: !!m.locked });
  });
});
console.log(`Total: ${total} | Con horario: ${withTime} | Fijados: ${locked} | NO fijados: ${unlocked}`);

Object.keys(byDayCourt).sort().forEach(key => {
  const list = byDayCourt[key].sort((a,b) => a.time.localeCompare(b.time));
  console.log(`\n=== ${key} ===`);
  list.forEach(m => console.log(`  ${m.time}  ${m.cat}${m.locked ? '' : '  <-- NO FIJADO'}`));
});
