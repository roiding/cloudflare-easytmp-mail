import React from 'react';
import { DEFAULT_MAIL_DOMAIN, DEFAULT_WEB_AND_API_DOMAIN } from '@easytmp/shared';

interface FooterProps {
  mailDomain?: string;
  webHostname?: string;
}

export const Footer: React.FC<FooterProps> = ({
  mailDomain = DEFAULT_MAIL_DOMAIN,
  webHostname = DEFAULT_WEB_AND_API_DOMAIN,
}) => {
  return (
    <footer className="app-footer">
      <div className="footer-container">
        <div className="footer-columns">
          <div className="footer-col">
            <h4 className="footer-heading">公开免密规则</h4>
            <p>
              本临时邮箱完全公开，无需登录、账户、Cookie 或 API
              Key。任何人在本站输入相同邮箱名，均可查看对应收件箱中尚未过期、尚未删除的邮件。请勿用于接收高价值敏感资产。
            </p>
          </div>

          <div className="footer-col">
            <h4 className="footer-heading">保留期与到期机制</h4>
            <p>
              每封邮件自服务器接收时刻起严格保留 <strong>7 天</strong>（604,800
              秒），到期后立即不可读并由后台定时清理。邮箱地址本身为固定收信标识，永久可用，不会过期。
            </p>
          </div>

          <div className="footer-col">
            <h4 className="footer-heading">无痕与自动化接入</h4>
            <p>
              本页面不在浏览器本地保存任何邮箱使用历史，离开即焚。支持同源 <code>/api/v1</code> HTTP
              接口，自动化注册任务可直接调用读取验证码。
            </p>
            <div className="footer-meta">
              <span>
                收件域名：<code>@{mailDomain}</code>
              </span>
              <span>
                服务域名：<code>{webHostname}</code>
              </span>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 EasyTmp Mail. Cloudflare Pages & Workers 纯无服务器架构运行.</p>
        </div>
      </div>
    </footer>
  );
};
