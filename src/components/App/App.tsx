import React, { Suspense } from 'react';
import type { AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import type { AppPluginSettings } from '../AppConfig/AppConfig';

const DotAIPage = React.lazy(() => import('../../pages/DotAIPage'));

function App(props: AppRootProps<AppPluginSettings>) {
  const showContext = props.meta.jsonData?.showContext !== false;
  const sendGrafanaEvidence = props.meta.jsonData?.sendGrafanaEvidence !== false;
  return (
    <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
      <DotAIPage showContext={showContext} sendGrafanaEvidence={sendGrafanaEvidence} />
    </Suspense>
  );
}

export default App;
