import React, { Suspense } from 'react';
import type { AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

const DotAIPage = React.lazy(() => import('../../pages/DotAIPage'));

function App(_props: AppRootProps) {
  return (
    <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
      <DotAIPage />
    </Suspense>
  );
}

export default App;
