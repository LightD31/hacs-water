// === Mémorisation de la prévision du jour et de demain ===
// Réponse de weather.get_forecasts : { "<entité>": { forecast: [ { datetime,
// temperature, templow, … } ] } }. On n'en garde que les extrêmes du jour et de
// demain, lus par « Lire capteurs & unités » pour décider de la saison.

const STORE = 'file';
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const resp = msg.payload || {};
const entry = resp[msg.weatherEntity] || Object.values(resp)[0] || {};
const list = Array.isArray(entry.forecast) ? entry.forecast : [];
if (list.length === 0) {
    node.warn('Prévision météo vide pour ' + msg.weatherEntity);
    return null;
}
const dayKey = (t) => new Date(t).toDateString();
const today = dayKey(Date.now());
const tomorrow = dayKey(Date.now() + 24 * 3600 * 1000);
const pick = (key) => list.find(f => dayKey(f.datetime) === key) || null;
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n * 10) / 10; };
const t0 = pick(today) || list[0];
const t1 = pick(tomorrow) || list[1] || null;
const fc = {
    at: Date.now(),
    todayMax: num(t0.temperature),
    todayMin: num(t0.templow),
    tomorrowMax: t1 ? num(t1.temperature) : null,
    tomorrowMin: t1 ? num(t1.templow) : null
};
setF('forecast', fc);
node.status({ fill: 'green', shape: 'dot', text: fc.todayMin + '–' + fc.todayMax + ' °C' });
return null;
