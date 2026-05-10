function cleanAdminStorageSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160) || "unknown";
}

export function getAdminPhotoStoragePath(uid: string) {
  return `admins/${cleanAdminStorageSegment(uid)}/profile-photo`;
}
