import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModCard } from './ModCard.js';

const BASE_PROPS = {
  fileId: '1753134636',
  title: 'Hawaii',
  author: '76561198000000001',
  description: '',
};

describe('ModCard', () => {
  // 问题 1：作者显示昵称而非 SteamID64
  it('authorName 存在时显示昵称', () => {
    render(<ModCard {...BASE_PROPS} authorName="Renaxon" />);
    expect(screen.getByText('Renaxon')).toBeTruthy();
  });

  it('authorName 缺失时回退 SteamID64', () => {
    render(<ModCard {...BASE_PROPS} />);
    expect(screen.getByText('76561198000000001')).toBeTruthy();
  });

  // 问题 2：ID 用 font-mono 弱化显示（样式分层）
  it('ID 用 font-mono class', () => {
    const { container } = render(<ModCard {...BASE_PROPS} />);
    const idEl = container.querySelector('.font-mono');
    expect(idEl).toBeTruthy();
    expect(idEl?.textContent).toContain('1753134636');
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

  // 问题 4：详情按钮走 shadcn ghost variant
  it('详情按钮触发 onDetails 回调', () => {
    const onDetails = vi.fn();
    render(<ModCard {...BASE_PROPS} onDetails={onDetails} />);
    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    expect(onDetails).toHaveBeenCalledWith('1753134636');
  });

  // 问题 5：按钮文案是「下载」而非「订阅」
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
  it('订阅数存在时显示紧凑格式', () => {
    render(<ModCard {...BASE_PROPS} subscriptions={12345} />);
    expect(screen.getByText(/1\.2万 订阅/)).toBeTruthy();
  });
});
