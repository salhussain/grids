import { describe, expect, it } from 'vitest';
import { fillFrom, mdToHtml, mdToText } from '../src/index.js';

describe('rich text for emails', () => {
  const fill = fillFrom({ name: 'Ana <b>', tags: ['a', 'b'] });

  it('formats a small subset', () => {
    const html = mdToHtml('## Hello\n\nHi **there**, *you* [site](https://example.org)\nsecond line\n\n- one\n- two\n\n1. first\n2. second', fill);
    expect(html).toContain('<h3');
    expect(html).toContain('<strong>there</strong>');
    expect(html).toContain('<em>you</em>');
    expect(html).toContain('<a href="https://example.org">site</a>');
    expect(html).toContain('<br>second line');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<ol');
  });

  it('never lets answers or typed markup become markup', () => {
    const html = mdToHtml('Dear ${name}, <script>alert(1)</script> [x](javascript:alert(1)) **${name}**', fill);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('Ana &lt;b&gt;');
    expect(html).toContain('<strong>Ana &lt;b&gt;</strong>');
    // answers are text: asterisks in them are not formatting
    expect(mdToHtml('${v}', fillFrom({ v: '**not bold**' }))).not.toContain('<strong>');
  });

  it('makes a plain-text version', () => {
    expect(mdToText('## Hi\n\nSee **this** [here](https://example.org)\n\n- a\n- b\n\n1. x', fill)).toBe('HI\n\nSee this here (https://example.org)\n\n• a\n• b\n\n1. x');
    expect(mdToText('Tags: ${tags}', fill)).toBe('Tags: a, b');
    expect(mdToText('Just a plain message\nover two lines')).toBe('Just a plain message\nover two lines');
  });
});
