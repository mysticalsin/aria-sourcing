function sessionCookie(value, url) {
  return {
    name: 'session_id',
    value,
    url,
    sameSite: 'Lax',
    httpOnly: true,
    expires: Math.floor(Date.now() / 1000) + (8 * 60 * 60),
  };
}

module.exports = { sessionCookie };
