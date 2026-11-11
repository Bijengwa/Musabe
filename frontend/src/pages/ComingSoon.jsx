import { PageHead, Panel } from '../components/ui';

export default function ComingSoon({ page }) {
  return (
    <>
      <PageHead title={page.label} />
      <Panel>
        <p style={{ margin: 0 }}>This page is part of <b>{page.step}</b>. Your account already has access to it; the screen will appear here when that step is built.</p>
      </Panel>
    </>
  );
}
