async function request(method, url, body, headers = {}) {
  const options = { method, headers: { ...headers } };
  if (body instanceof Blob) {
    options.body = body;
    options.headers['Content-Type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `La petición falló (${res.status}).`);
  return data;
}

export const api = {
  state:        () => request('GET', '/api/state'),
  scan:         () => request('POST', '/api/scan'),
  addRoot:      (path) => request('POST', '/api/roots', { path }),
  removeRoot:   (id) => request('DELETE', `/api/roots/${id}`),

  courses:      (params = {}) => request('GET', '/api/courses?' + new URLSearchParams(params)),
  continueWith: () => request('GET', '/api/continue'),
  flagged:      () => request('GET', '/api/flagged'),

  course:       (id) => request('GET', `/api/courses/${id}`),
  addCourse:    (payload) => request('POST', '/api/courses', payload),
  previewFolder:(path) => request('POST', '/api/courses/preview', { path }),
  updateCourse: (id, patch) => request('PATCH', `/api/courses/${id}`, patch),
  rescanCourse: (id) => request('POST', `/api/courses/${id}/rescan`),
  removeCourse: (id) => request('DELETE', `/api/courses/${id}`),
  uploadCover:  (id, blob) => request('POST', `/api/courses/${id}/cover`, blob),
  clearCover:   (id) => request('DELETE', `/api/courses/${id}/cover`),

  updateModule: (id, patch) => request('PATCH', `/api/modules/${id}`, patch),

  lesson:       (id) => request('GET', `/api/lessons/${id}`),
  updateLesson: (id, patch) => request('PATCH', `/api/lessons/${id}`, patch),
  saveProgress: (id, payload) => request('POST', `/api/lessons/${id}/progress`, payload),
  saveNotes:    (id, body) => request('PUT', `/api/lessons/${id}/notes`, { body }),
  openExternal: (id) => request('POST', `/api/lessons/${id}/open-external`),
  openFolder:   (id) => request('POST', `/api/lessons/${id}/open-folder`),
  remux:        (id) => request('POST', `/api/lessons/${id}/remux`),
};
