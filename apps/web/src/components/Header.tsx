import React from 'react';
import { IconMail } from './Icons';

export const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-container">
        <div className="brand-group">
          <div className="brand-icon">
            <IconMail size={22} />
          </div>
          <div className="brand-text">
            <h1 className="brand-title">EasyTmp 临时邮箱</h1>
            <span className="brand-domain">基于 Cloudflare Pages & Workers</span>
          </div>
        </div>

        <div className="policy-badges" aria-label="服务特性说明">
          <span className="badge badge-primary">完全免密公开</span>
          <span className="badge">同名地址共享</span>
          <span className="badge">邮件保留 7 天</span>
          <span className="badge">地址永久不过期</span>
          <span className="badge badge-subtle">无浏览痕迹</span>
        </div>
      </div>
    </header>
  );
};
