// =============================================================================
// VimPaste 持续集成流水线（测试 + 构建 + 镜像推送）
// =============================================================================
// 运行形态与 firmament 项目一致：每次构建由 Jenkins Kubernetes 插件在集群里
// 临时创建一个 Pod 作为构建代理，构建结束后 Pod 销毁。Pod 里有两个业务容器：
//
//   nodejs —— 代码检查、单元测试、前端构建（内含 Node.js 24）
//   docker —— 构建并推送镜像（内含 docker CLI）
//
// 插件还会自动注入一个 jnlp 容器负责和 Jenkins master 通信，无需在此声明。
// 流水线的每个 steps 默认落在 jnlp 容器里，所以凡是要用 nodejs 或 docker 的
// 步骤，都必须用 container('nodejs') / container('docker') 显式切换。
//
// 与 firmament 的差异：本项目只做测试与构建，没有部署阶段；镜像推送到
// GitHub Container Registry（ghcr.io），标签只打 commit 短 SHA，不打 latest，
// 每个 commit 的镜像不可变，可随时按 SHA 回溯。
// =============================================================================
pipeline {
    agent {
        kubernetes {
            // Jenkins「系统管理 → 节点和云」中配置的 Kubernetes 云名称。
            // 与 firmament 各流水线共用同一个云；若那里改了名字，这里要同步。
            cloud 'kubernetes'

            // 直接在流水线里内联 Pod 定义，而不是引用 Jenkins UI 上预设的
            // Pod Template，构建环境随代码一起版本化，可评审、可回滚。
            yaml '''
apiVersion: v1
kind: Pod
metadata:
  labels:
    jenkins/label: vimpaste-build
spec:
  containers:
    # -------------------------------------------------------
    # 容器一：nodejs —— 代码检查、单元测试、前端构建
    # -------------------------------------------------------
    # command/args 覆写成 sleep 是 Jenkins K8s 插件的固定写法：容器必须保持
    # 存活，等流水线用 container('nodejs') 进来执行命令。若不覆写，镜像跑完
    # 默认入口就退出了，Pod 随即失败。
    - name: nodejs
      image: node:24-alpine
      command:
        - sleep
      args:
        - "9999999"
      tty: true
      workingDir: /home/jenkins/agent

    # -------------------------------------------------------
    # 容器二：docker —— 构建并推送镜像
    # -------------------------------------------------------
    # 只装了 docker CLI，没有 Docker 守护进程；实际工作交给下面挂进来的
    # 宿主机 socket 上的守护进程执行。
    - name: docker
      image: docker:latest
      command:
        - sleep
      args:
        - "9999999"
      tty: true
      workingDir: /home/jenkins/agent
      volumeMounts:
        # docker CLI 通过这个 socket 指挥宿主节点的 Docker 守护进程干活
        - mountPath: /var/run/docker.sock
          name: docker-sock

  # -------------------------------------------------------
  # 卷定义
  # -------------------------------------------------------
  volumes:
    # 宿主节点的 Docker 守护进程 socket。与 firmament 相同的做法；
    # 该挂载的信任边界说明见 firmament-take-out/Jenkinsfile。
    - name: docker-sock
      hostPath:
        path: /var/run/docker.sock
'''
        }
    }

    stages {
        stage('1. 拉取代码') {
            steps {
                checkout scm
            }
        }

        stage('2. 代码检查与单元测试') {
            steps {
                container('nodejs') {
                    echo '安装依赖...'
                    sh 'npm ci'
                    echo '正在运行 ESLint 代码检查...'
                    sh 'npm run lint'
                    echo '正在运行 TypeScript 类型检查...'
                    sh 'npm run typecheck'
                    // --run 强制 vitest 跑一遍就退出，不进入 watch 模式
                    echo '正在运行单元测试（Vitest）...'
                    sh 'npm test -- --run'
                }
            }
        }

        stage('3. 构建项目') {
            steps {
                container('nodejs') {
                    // npm run build = tsc -b + vite build + scripts/check-build.mjs
                    //（构建产物缺失或 gzip 体积超出预算时以非零退出码失败）
                    echo '构建前端项目...'
                    sh 'npm run build'
                }
            }
        }

        stage('4. 构建并推送镜像') {
            // changeRequest() 在构建来自 Pull Request 时为真。PR 只需验证代码
            // 能过测试，不该往镜像仓库推产物，因此这一步跳过。
            when {
                not { changeRequest() }
            }
            steps {
                container('docker') {
                    script {
                        // GitHub Container Registry 登录凭据（Jenkins 端为
                        // usernamePassword 类型，ID 必须是 ghcr-credentials）：
                        //   用户名 = GitHub 用户名
                        //   密码   = 具有 write:packages 权限的 Personal Access Token
                        withCredentials([usernamePassword(credentialsId: 'ghcr-credentials', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_PASS')]) {
                            // 工作区目录的属主与本容器内的当前用户不一致时，Git 会以
                            // "dubious ownership" 为由拒绝操作。把目录标记为可信来放行，
                            // 好让下面能读到 commit 号用作镜像标签。
                            sh '''
                                git config --global --add safe.directory ${WORKSPACE} || true
                                git config --global --add safe.directory "$(pwd)" || true
                            '''

                            def gitCommit = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()

                            // 镜像名 ghcr.io/<GitHub 用户名>/vimpaste，标签 = commit 短 SHA。
                            // ghcr 要求命名空间全小写，这里统一 toLowerCase 兜底。
                            def image = "ghcr.io/${env.GHCR_USER.toLowerCase()}/vimpaste:${gitCommit}"

                            echo "准备推送镜像: ${image}"

                            // --password-stdin 避免令牌出现在进程命令行中
                            sh 'echo $GHCR_PASS | docker login ghcr.io -u $GHCR_USER --password-stdin'

                            // 只打 commit 短 SHA 标签并推送；按需求不打 latest
                            sh "docker build -t ${image} ."
                            sh "docker push ${image}"

                            sh "docker logout ghcr.io"
                        }
                    }
                }
            }
        }
    }

    post {
        success {
            echo "✅ 测试、构建与镜像推送成功"
        }
        failure {
            echo "❌ 测试、构建或推送失败，请检查日志"
        }
        always {
            cleanWs() // 清理工作空间
        }
    }
}
