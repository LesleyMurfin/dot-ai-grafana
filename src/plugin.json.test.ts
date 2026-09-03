import pluginJson from './plugin.json';

describe('plugin.json', () => {
  test('id is devopstoolkit-dotai-app', () => {
    expect(pluginJson.id).toBe('devopstoolkit-dotai-app');
  });
});
