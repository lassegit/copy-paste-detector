import { Layout } from './layout'

export default function NotFound() {
  return (
    <Layout title="Not found">
      <h1>404</h1>
      <p>
        No page here. <a href="/">Back to the playground</a>.
      </p>
    </Layout>
  )
}
