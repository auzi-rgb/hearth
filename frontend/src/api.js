// Thin wrapper around fetch that:
//   - attaches Bearer token for /finance/api/ requests
//   - redirects to login on 401
const _fetch = window.fetch.bind(window)

export function getToken() {
  return localStorage.getItem('finance_token')
}

export function clearToken() {
  localStorage.removeItem('finance_token')
}

export function isTokenValid() {
  const token = getToken()
  if (!token) return false
  try {
    // Decode the payload without verifying (we trust our own backend)
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

window.fetch = function (url, opts = {}) {
  const token = getToken()
  // Only inject auth header for our own API
  if (token && typeof url === 'string' && url.startsWith('/hearth/api')) {
    opts = {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    }
  }
  return _fetch(url, opts).then(res => {
    if (res.status === 401 && typeof url === 'string' && url.startsWith('/hearth/api')) {
      clearToken()
      // Signal App to show login — use a custom event so App can react without a reload
      window.dispatchEvent(new CustomEvent('finance:unauthorized'))
    }
    return res
  })
}
