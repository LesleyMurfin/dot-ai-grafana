import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

test.describe('dot-ai app navigation', () => {
  test('should render tools page', async ({ gotoPage, page }) => {
    await gotoPage('/');
    await expect(page.getByTestId(testIds.dotai.container)).toBeVisible();
    await expect(page.getByTestId(testIds.dotai.intent)).toBeVisible();
    await expect(page.getByTestId(testIds.dotai.submit)).toBeVisible();
  });
});
