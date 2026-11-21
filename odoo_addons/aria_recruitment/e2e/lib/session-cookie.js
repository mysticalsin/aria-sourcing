function sessionCookie(value, url) {
  return { name: 'session_id', value, url };
}

module.exports = { sessionCookie };
