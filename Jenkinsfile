// =============================================================================
// VimPaste 持续集成流水线（测试 + 构建 + 镜像推送）
// =============================================================================
// 运行形态与 firmament 项目一致：每次构建由 Jenkins Kubernetes 插件在集群里
// 临时创建一个 Pod 作为构建代理，构建结束后 Pod 销毁。Pod 里有三个业务容器：
//
//   nodejs —— 代码检查、单元测试、前端构建（内含 Node.js 24）
//   docker —— 构建并推送镜像（内含 docker CLI）
//   gitops —— Git 操作与修改 YAML（内含 git 和 yq）
//
// 插件还会自动注入一个 jnlp 容器负责和 Jenkins master 通信，无需在此声明。
// 流水线的每个 steps 默认落在 jnlp 容器里，所以凡是要用 nodejs、docker 或
// gitops 的步骤，都必须用 container('nodejs') / container('docker') /
// container('gitops') 显式切换。
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
    # 容器二：postgres —— v2 API 集成测试的数据库（server/ 测试需要）
    # -------------------------------------------------------
    # 与生产/本地 compose 保持一致用 postgres:17-alpine，避免迁移在两侧行为不同。
    # Pod 每次构建临时创建，数据不持久化。
    - name: postgres
      image: postgres:17-alpine
      env:
        - name: POSTGRES_USER
          value: vimpaste
        - name: POSTGRES_PASSWORD
          value: vimpaste
        - name: POSTGRES_DB
          value: vimpaste
      readinessProbe:
        exec:
          command: ['pg_isready', '-U', 'vimpaste', '-d', 'vimpaste']
        initialDelaySeconds: 2
        periodSeconds: 3

    # -------------------------------------------------------
    # 容器三：docker —— 构建并推送镜像
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
    # 容器四：gitops —— Git 操作与修改 YAML
    # -------------------------------------------------------
    # 基础 alpine 镜像，启动时现场安装 git 和 yq。它只做 Git 操作和改
    # YAML（GitOps），不需要操作 Docker 守护进程，因此不挂载
    # /var/run/docker.sock。
    - name: gitops
      image: alpine:3.22
      command:
        - sh
        - -c
      args:
        - apk add --no-cache git yq ca-certificates && sleep 9999999
      tty: true
      workingDir: /home/jenkins/agent

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
        // 临时 stage：验证 gitops 容器真的可用（git / yq 装好了），后续
        // GitOps 步骤落地后即删除。
        stage('0. 验证 GitOps 工具') {
            steps {
                container('gitops') {
                    sh 'git --version'
                    sh 'yq --version'
                }
            }
        }

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

                    // v2：server/ 是独立 npm 包，用自己的工具链跑质量门
                    echo '安装 server 依赖...'
                    sh 'cd server && npm ci'
                    echo '正在运行 server ESLint...'
                    sh 'cd server && npm run lint'
                    echo '正在运行 server 类型检查...'
                    sh 'cd server && npm run typecheck'
                    echo '正在等待测试数据库就绪...'
                    sh '''
                        timeout=60
                        until node -e "const net=require('net');const s=net.connect(5432,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1))" 2>/dev/null; do
                            timeout=$((timeout-2))
                            if [ $timeout -le 0 ]; then echo 'postgres sidecar 未就绪'; exit 1; fi
                            sleep 2
                        done
                    '''
                    echo '正在应用测试库迁移...'
                    sh 'cd server && TEST_DATABASE_URL=postgresql://vimpaste:vimpaste@127.0.0.1:5432/vimpaste npx prisma migrate deploy'
                    echo '正在运行 server 集成测试（Vitest + Prisma）...'
                    sh 'cd server && TEST_DATABASE_URL=postgresql://vimpaste:vimpaste@127.0.0.1:5432/vimpaste npm test -- --run'
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
            // 不区分分支与 PR：任何构建（包括 PR 构建）都推送镜像，
            // 便于在合入前就能拿 PR 的镜像到真实环境（如 k3s）验证。
            // 标签是本次 commit 的短 SHA，各分支/PR 的镜像互不覆盖。
            steps {
                container('docker') {
                    script {
                        // GitHub Container Registry 登录凭据：专用凭据 ghcr-token
                        //（usernamePassword 类型）：用户名 = kaiwenyao，密码 = 勾选了
                        // write:packages 的 classic PAT。该凭据只用于推镜像，权限
                        // 最小化；git 拉取/推送等其他用途仍走 github-token。
                        withCredentials([usernamePassword(credentialsId: 'ghcr-token', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_PASS')]) {
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

                            // v2：API 镜像（server/Dockerfile 多阶段，见文件头注释）
                            def apiImage = "ghcr.io/${env.GHCR_USER.toLowerCase()}/vimpaste-api:${gitCommit}"
                            echo "准备推送 API 镜像: ${apiImage}"
                            sh "docker build -t ${apiImage} -f server/Dockerfile ."
                            sh "docker push ${apiImage}"

                            sh "docker logout ghcr.io"
                        }
                    }
                }
            }
        }

        // GitOps 落地：把 k3s-home 中 vimpaste 的镜像更新为本次构建的镜像，
        // 并直接 commit + push 到 k3s-home main；清单已是当前镜像时跳过。
        stage('5. 更新 GitOps 清单') {
            when {
                branch 'main'
            }

            steps {
                container('gitops') {
                    withCredentials([
                        usernamePassword(
                            credentialsId: 'k3s-home-write',
                            usernameVariable: 'GITOPS_USER',
                            passwordVariable: 'GITOPS_TOKEN'
                        )
                    ]) {
                        sh '''
                            set -eu

                            rm -rf gitops-repo

                            cat > /tmp/git-askpass.sh <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) echo "$GITOPS_USER" ;;
  *Password*) echo "$GITOPS_TOKEN" ;;
esac
EOF

                            chmod 700 /tmp/git-askpass.sh
                            trap 'rm -f /tmp/git-askpass.sh' EXIT

                            GIT_ASKPASS=/tmp/git-askpass.sh \
                            GIT_TERMINAL_PROMPT=0 \
                            git clone https://github.com/kaiwenyao/k3s-home.git gitops-repo

                            # gitops 容器与 docker 容器一样以 root 运行，而工作区
                            # 属主是 jnlp 的 jenkins 用户：不先标记 safe.directory，
                            # 下面的 git rev-parse 会因 dubious ownership 失败
                            #（同 Stage 4 的处理）。
                            git config --global --add safe.directory ${WORKSPACE} || true
                            git config --global --add safe.directory "$(pwd)" || true

                            NEW_IMAGE="ghcr.io/kaiwenyao/vimpaste:$(git rev-parse --short HEAD)"
                            NEW_API_IMAGE="ghcr.io/kaiwenyao/vimpaste-api:$(git rev-parse --short HEAD)"

                            echo "部署镜像: $NEW_IMAGE / $NEW_API_IMAGE"

                            sed -i \
                              "s#image: ghcr.io/kaiwenyao/vimpaste:.*#image: ${NEW_IMAGE}#" \
                              gitops-repo/apps/vimpaste/deployment.yaml

                            # v2 API 清单尚未合入 k3s-home 时跳过（合并本 PR 后把
                            # deploy/k3s/ 的清单拷入 k3s-home 即启用）
                            if [ -f gitops-repo/apps/vimpaste-api/deployment.yaml ]; then
                                sed -i \
                                  "s#image: ghcr.io/kaiwenyao/vimpaste-api:.*#image: ${NEW_API_IMAGE}#" \
                                  gitops-repo/apps/vimpaste-api/deployment.yaml
                            else
                                echo "k3s-home 暂无 apps/vimpaste-api/deployment.yaml，跳过 API 镜像更新"
                            fi

                            if git -C gitops-repo diff --quiet; then
                                echo "GitOps 清单已经是当前镜像，无需更新"
                                exit 0
                            fi

                            git -C gitops-repo config user.name "Jenkins"
                            git -C gitops-repo config user.email "jenkins@vimpaste.local"

                            git -C gitops-repo add apps/vimpaste apps/vimpaste-api 2>/dev/null || git -C gitops-repo add apps/vimpaste
                            git -C gitops-repo commit -m "deploy(vimpaste): ${NEW_IMAGE##*:}"

                            GIT_ASKPASS=/tmp/git-askpass.sh \
                            GIT_TERMINAL_PROMPT=0 \
                            git -C gitops-repo push origin main
                        '''
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
