export function migrate(record) {
  return { ...record, schemaVersion: 1 };
}
