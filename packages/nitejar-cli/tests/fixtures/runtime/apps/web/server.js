import http from 'node:http'

const port = Number.parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOSTNAME || '127.0.0.1'

if (process.env.NITEJAR_TEST_SERVER_MODE === 'exit') {
  console.error('fixture server forced exit')
  process.exit(1)
}

if (process.env.NITEJAR_TEST_SERVER_MODE === 'hang') {
  setInterval(() => {}, 1000)
} else {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })

  server.listen(port, host)

  const shutdown = () => {
    server.close(() => process.exit(0))
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
