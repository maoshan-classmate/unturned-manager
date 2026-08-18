import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModCard } from './ModCard.js';

const BASE_PROPS = {
  fileId: '1753134636',
  title: 'Hawaii',
  description: '',
};

describe('ModCard', () => {
  // 不展示作者/ID 信息（对齐设计：只显示订阅数）
  it('不显示作者 SteamID', () => {
    render(<ModCard {...BASE_PROPS} />);
    expect(screen.queryByText(/7656119\d{10}/)).toBeNull();
  });

  it('不显示 Workshop File ID', () => {
    render(<ModCard {...BASE_PROPS} />);
    expect(screen.queryByText('1753134636')).toBeNull();
  });

  // 问题 3：BBCode 已 strip（不显示 [h1] 残留）
  it('description BBCode 被 strip', () => {
    render(<ModCard {...BASE_PROPS} description="[h1]Tropical map[/h1] [EN]English[/EN]" />);
    expect(screen.queryByText(/\[h1\]/)).toBeNull();
    expect(screen.queryByText(/\[EN\]/)).toBeNull();
    expect(screen.getByText(/Tropical map English/)).toBeTruthy();
  });

  it('description 为空时显示 暂无描述', () => {
    render(<ModCard {...BASE_PROPS} />);
    expect(screen.getByText('暂无描述')).toBeTruthy();
  });

  // 详情按钮触发回调
  it('详情按钮触发 onDetails 回调', () => {
    const onDetails = vi.fn();
    render(<ModCard {...BASE_PROPS} onDetails={onDetails} />);
    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    expect(onDetails).toHaveBeenCalledWith('1753134636');
  });

  // 按钮文案是「下载」而非「订阅」
  it('按钮显示「下载」而非「订阅」', () => {
    render(<ModCard {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /下载/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /订阅/ })).toBeNull();
  });

  it('下载按钮触发 onDownload 回调', () => {
    const onDownload = vi.fn();
    render(<ModCard {...BASE_PROPS} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: /下载/ }));
    expect(onDownload).toHaveBeenCalledWith('1753134636');
  });

  // 订阅数显示
  it('订阅数存在时显示', () => {
    const { container } = render(<ModCard {...BASE_PROPS} subscriptions={12345} />);
    // 订阅数与「订阅」字样被 span 拆开——直接断言容器 textContent 包含全文
    expect(container.textContent).toContain("12,345 订阅");
  });

  it('订阅数为空时不显示', () => {
    const { container } = render(<ModCard {...BASE_PROPS} />);
    expect(container.textContent).not.toContain("订阅");
  });
});
