// === Demande de prévision journalière (weather.get_forecasts) ===
// Toutes les heures. Entité météo : CLIM_WEATHER_ENTITY (vide = désactivé).

const id = env.get('CLIM_WEATHER_ENTITY');
const weather = (id === undefined || id === null || id === '') ? 'weather.forecast_maison' : String(id);
if (weather === 'none') return null;
msg.weatherEntity = weather;
msg.payload = { target: { entity_id: [weather] }, data: { type: 'daily' } };
return msg;
