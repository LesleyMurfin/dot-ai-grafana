import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

const DotAIPage = React.lazy(() => import('../../pages/DotAIPage'));

function App(_props: AppRootProps) {
  return (
    <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
      <Routes>
        <Route path="*" element={<DotAIPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
