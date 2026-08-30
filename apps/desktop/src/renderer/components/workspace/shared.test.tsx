// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArtifactImage } from './shared.js';

describe('ArtifactImage', () => {
  it('does not carry one screenshot failure into a newly selected source', () => {
    const { rerender } = render(
      <ArtifactImage src="sitepull-capture://capture/one.png" alt="One" />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'One' }));
    expect(screen.getByText('Preview unavailable')).toBeTruthy();

    rerender(<ArtifactImage src="sitepull-capture://capture/two.png" alt="Two" />);
    expect(screen.getByRole('img', { name: 'Two' }).getAttribute('src')).toBe(
      'sitepull-capture://capture/two.png',
    );
  });
});
