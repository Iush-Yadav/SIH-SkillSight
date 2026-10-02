const locations = [
  ['TC-UP-001', 'Pradhan Mantri Kaushal Kendra', 'Lucknow', 'Uttar Pradesh', 'Electronics & hardware', 40, 28, 'online'],
  ['TC-RJ-002', 'Jaipur Skill Development Centre', 'Jaipur', 'Rajasthan', 'Apparel & tailoring', 36, 35, 'online'],
  ['TC-MH-003', 'Pune Technical Training Institute', 'Pune', 'Maharashtra', 'Automotive technology', 42, 40, 'online'],
  ['TC-BR-004', 'Patna Vocational Training Centre', 'Patna', 'Bihar', 'Electrical installation', 38, 30, 'online'],
  ['TC-MP-005', 'Indore Kaushal Vikas Kendra', 'Indore', 'Madhya Pradesh', 'IT & IT-enabled services', 44, 43, 'online'],
  ['TC-OD-006', 'Bhubaneswar Skill Academy', 'Bhubaneswar', 'Odisha', 'Construction & masonry', 32, 31, 'online'],
  ['TC-UP-007', 'Varanasi Artisan Training Centre', 'Varanasi', 'Uttar Pradesh', 'Handicrafts & textiles', 35, 34, 'online'],
  ['TC-RJ-008', 'Udaipur Hospitality Institute', 'Udaipur', 'Rajasthan', 'Tourism & hospitality', 30, null, 'offline'],
  ['TC-MH-009', 'Nagpur Industrial Skills Centre', 'Nagpur', 'Maharashtra', 'Industrial manufacturing', 40, 38, 'online'],
  ['TC-BR-010', 'Gaya Rural Skills Academy', 'Gaya', 'Bihar', 'Retail & logistics', 28, 27, 'online'],
  ['TC-MP-011', 'Bhopal Technical Skills Centre', 'Bhopal', 'Madhya Pradesh', 'Solar panel installation', 36, null, 'offline'],
  ['TC-OD-012', 'Cuttack Vocational Institute', 'Cuttack', 'Odisha', 'Plumbing & maintenance', 34, 33, 'online'],
];

export function makeInitialState() {
  const now = new Date().toISOString();
  const centers = locations.map(([id, name, city, state, course, claimed, detected, connection], index) => ({
    id, name, city, state, course, claimed, detected, connection, capacity: 48, cameras: index % 3 + 2,
    source: 'simulation', updatedAt: now,
    inventory: [
      { id: 'seating', name: 'Training seats', icon: 'chair', approved: 48, detected: connection === 'offline' ? null : 48, operability: 'Unknown' },
      { id: 'workbenches', name: 'Workbenches', icon: 'bench', approved: 8, detected: connection === 'offline' ? null : index === 3 ? 6 : 8, operability: 'Unknown' },
      { id: 'computers', name: 'Computer systems', icon: 'computer', approved: 12, detected: connection === 'offline' ? null : index === 0 ? 10 : 12, operability: index === 8 ? 'Needs maintenance' : 'Unknown' },
      { id: 'equipment', name: 'Trade equipment', icon: 'tool', approved: 4, detected: connection === 'offline' ? null : 4, operability: 'Unknown' },
    ],
  }));
  return { version: 1, centers, alerts: [
    { id: 'ALT-00941', centreId: 'TC-UP-001', centreName: 'Pradhan Mantri Kaushal Kendra', type: 'Attendance mismatch', severity: 'high', summary: '12-person difference between submitted register and observed presence.', evidence: 'Camera 01 · 91% confidence', status: 'open', createdAt: new Date(Date.now() - 18 * 60000).toISOString() },
    { id: 'ALT-00939', centreId: 'TC-BR-004', centreName: 'Patna Vocational Training Centre', type: 'Infrastructure gap', severity: 'medium', summary: 'Two workbenches not visible in the latest centre snapshot.', evidence: 'Camera 02 · 84% confidence', status: 'open', createdAt: new Date(Date.now() - 47 * 60000).toISOString() },
    { id: 'ALT-00931', centreId: 'TC-MH-009', centreName: 'Nagpur Industrial Skills Centre', type: 'Operability note', severity: 'low', summary: 'Computer systems count is present; maintenance status needs field confirmation.', evidence: 'Centre response pending', status: 'open', createdAt: new Date(Date.now() - 3 * 3600000).toISOString() },
    { id: 'ALT-00918', centreId: 'TC-OD-006', centreName: 'Bhubaneswar Skill Academy', type: 'Attendance mismatch', severity: 'medium', summary: '9-person difference persisted across three snapshots.', evidence: 'Cameras 01 + 02 · review set', status: 'resolved', resolvedBy: 'Ananya Rao', resolvedAt: new Date(Date.now() - 8 * 3600000).toISOString(), createdAt: new Date(Date.now() - 10 * 3600000).toISOString() },
  ], history: [], settings: { lowBandwidth: false, mismatchThreshold: 10 }, createdAt: now };
}

// These scores are deliberately synthetic fixtures, NOT measurements of a trained model.
export const evaluationSamples = [
  { id: 'S01', condition: 'Clear view', truth: true, score: .96 },
  { id: 'S02', condition: 'Clear view', truth: true, score: .91 },
  { id: 'S03', condition: 'Clear view', truth: false, score: .12 },
  { id: 'S04', condition: 'Clear view', truth: false, score: .18 },
  { id: 'S05', condition: 'Clear view', truth: true, score: .88 },
  { id: 'S06', condition: 'Low light', truth: true, score: .41 },
  { id: 'S07', condition: 'Low light', truth: false, score: .62 },
  { id: 'S08', condition: 'Low light', truth: true, score: .79 },
  { id: 'S09', condition: 'Low light', truth: false, score: .31 },
  { id: 'S10', condition: 'Low light', truth: true, score: .71 },
  { id: 'S11', condition: 'Occlusion', truth: true, score: .38 },
  { id: 'S12', condition: 'Occlusion', truth: false, score: .67 },
  { id: 'S13', condition: 'Occlusion', truth: true, score: .82 },
  { id: 'S14', condition: 'Occlusion', truth: false, score: .22 },
  { id: 'S15', condition: 'Occlusion', truth: true, score: .76 },
  { id: 'S16', condition: 'Low resolution', truth: true, score: .58 },
  { id: 'S17', condition: 'Low resolution', truth: false, score: .43 },
  { id: 'S18', condition: 'Low resolution', truth: true, score: .84 },
  { id: 'S19', condition: 'Low resolution', truth: false, score: .19 },
  { id: 'S20', condition: 'Low resolution', truth: false, score: .29 },
];

export const replayCounts = [28, 29, 28, 30, 29, 27, 28, 29, 30, 28, 27, 28];
export const dailyTrend = [
  { time: '09:00', reported: 368, observed: 310 },
  { time: '10:00', reported: 396, observed: 355 },
  { time: '11:00', reported: 402, observed: 370 },
  { time: '12:00', reported: 405, observed: 348 },
  { time: '13:00', reported: 387, observed: 305 },
  { time: '14:00', reported: 406, observed: 363 },
  { time: '15:00', reported: 414, observed: 372 },
  { time: '16:00', reported: 411, observed: 369 },
];
