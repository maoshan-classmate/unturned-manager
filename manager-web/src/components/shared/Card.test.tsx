import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Server } from 'lucide-react';
import { Card } from './Card.js';

describe('Card', () => {
  it('默认渲染——无 hover 动效、无 animation class', () => {
    render(<Card>内容</Card>);
    const card = screen.getByTestId('card');
    expect(card.getAttribute('data-hover')).toBe('none');
    expect(card.getAttribute('data-animation')).toBe('none');
    expect(card.className).not.toContain('translate-y');
    expect(card.className).not.toContain('shadow-');
    expect(card.className).not.toContain('animate-');
  });

  it('hover=lift 渲染 translateY 抬升过渡', () => {
    render(<Card hover="lift">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('motion-safe:hover:-translate-y-0.5');
  });

  it('hover=glow 渲染 emerald 投影过渡', () => {
    render(<Card hover="glow">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('motion-safe:hover:shadow-');
  });

  it('animation=fade-in 渲染 card-fade-in keyframes class', () => {
    render(<Card animation="fade-in">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('animate-[card-fade-in_200ms_ease-out]');
  });

  it('animation=stagger 委托父级,不渲染独立动效', () => {
    render(<Card animation="stagger">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).not.toContain('animate-');
  });

  it('title + icon 一起渲染头部', () => {
    render(
      <Card icon={Server} title="服务器控制">
        body
      </Card>,
    );
    expect(screen.getByText('服务器控制')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('无 title 也有 icon 时只渲染 icon', () => {
    const { container } = render(
      <Card icon={Server}>body</Card>,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('无 title 也有 icon 时不渲染 h3 标题', () => {
    render(<Card icon={Server}>body</Card>);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('无 icon 无 title 不渲染头部', () => {
    const { container } = render(<Card>body</Card>);
    // 头部 div 应该是 1 个 head div + 1 个 children container;head 不含任何内容
    const headDiv = container.querySelector('.flex.items-center.gap-2');
    expect(headDiv).toBeNull();
  });

  it('hover 与 animation 可同时生效', () => {
    render(<Card hover="lift" animation="fade-in">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('motion-safe:hover:-translate-y-0.5');
    expect(card.className).toContain('animate-[card-fade-in_200ms_ease-out]');
  });

  it('className 透传正确', () => {
    render(<Card className="my-extra">x</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('my-extra');
  });
});
