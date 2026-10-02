// A local upload remains an available observation even without a connected camera.
export const attendanceAvailable = centre => Number.isSafeInteger(centre.detected) && centre.detected >= 0 && (centre.connection === 'online' || centre.source === 'local-ai');
export const inventoryAvailable = (centre, item) => Number.isSafeInteger(item.detected) && item.detected >= 0 && (centre.connection === 'online' || item.source === 'local-ai');
