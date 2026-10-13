# 课表 · Timetable（课表编辑查看）

纯 HTML + CSS + JavaScript 的课表应用，前端托管在 GitHub Pages，云端使用 Supabase（PostgreSQL + Realtime），手机与电脑双端实时同步。

## 功能

- 周视图网格（周一~周日 × 各节次），点击卡片查看详情
- 添加 / 修改 / 删除课程，新增时自动检测时间冲突
- Supabase Realtime `postgres_changes` 实时同步，无需刷新
- 多学期管理，不同学期课表相互隔离
- 响应式：桌面端侧边栏 + 网格；手机端底部导航 + 按星期分组列表

## 目录结构

```
.
├── index.html   # 页面结构
├── styles.css   # 自定义样式
├── config.js    # Supabase 连接信息与节次配置
├── app.js       # 核心逻辑
├── README.md
└── .nojekyll
```


