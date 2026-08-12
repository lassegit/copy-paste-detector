import { Layout } from './layout'

export default function ServerError({ error }: { error?: unknown }) {
  const message = error instanceof Error ? error.message : null

  return (
    <Layout title="Something broke">
      <h1>500</h1>
      <p>Something broke on the server.</p>
      {message && <pre>{message}</pre>}
      <p>
        <a href="/">Back to the playground</a>.
      </p>
    </Layout>
  )
}
