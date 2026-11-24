#!/bin/bash
# AI 安全学习站点启动脚本：固定端口 8899，禁止端口漂移
# 幂等：重复 start 不会起第二个实例；PID 文件 + 端口对账；异常 fail loud
set -euo pipefail

PORT=8899
BIND=127.0.0.1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT}/.serve.pid"
LOG_FILE="${ROOT}/.serve.log"

port_pids() {
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | sort -u | tr '\n' ' ' || true
}

saved_pid() {
  if [ -f "${PID_FILE}" ]; then
    cat "${PID_FILE}" | tr -d '[:space:]'
  fi
}

is_ours() {
  local p="$1"
  [ -n "${p}" ] || return 1
  kill -0 "${p}" 2>/dev/null || return 1
  local cmd
  cmd="$(ps -p "${p}" -o command= 2>/dev/null || true)"
  case "${cmd}" in
    *"http.server"*"${PORT}"*) return 0 ;;
    *) return 1 ;;
  esac
}

health() {
  curl -fsS --max-time 2 "http://${BIND}:${PORT}/index.html" >/dev/null 2>&1
}

case "${1:-start}" in
  status)
    SP="$(saved_pid)"
    echo "固定端口: ${PORT}"
    echo "端口监听 PID: $(port_pids)"
    echo "记录 PID: ${SP:-无}"
    if [ -n "${SP}" ] && is_ours "${SP}" && health; then
      echo "状态: 运行中 → http://${BIND}:${PORT}/index.html"
    else
      echo "状态: 未运行"
    fi
    ;;
  start)
    SP="$(saved_pid)"
    LISTENERS="$(port_pids)"
    if [ -n "${SP}" ] && is_ours "${SP}"; then
      if health; then
        echo "站点已在 ${PORT} 端口运行 (PID ${SP})，无需重复启动"
        exit 0
      fi
      echo "错误: PID ${SP} 存活但站点无响应" >&2
      exit 1
    fi
    [ -f "${PID_FILE}" ] && rm -f "${PID_FILE}"
    if [ -n "${LISTENERS}" ]; then
      echo "错误: 端口 ${PORT} 已被占用 (PID ${LISTENERS})，拒绝改用其他端口" >&2
      echo "请先释放该端口，或执行 $0 stop" >&2
      exit 1
    fi
    cd "${ROOT}"
    nohup python3 -m http.server "${PORT}" --bind "${BIND}" >"${LOG_FILE}" 2>&1 &
    NEW_PID=$!
    echo "${NEW_PID}" > "${PID_FILE}"
    for i in $(seq 1 30); do
      if health && is_ours "${NEW_PID}"; then
        echo "站点已启动: http://${BIND}:${PORT}/index.html (PID ${NEW_PID})"
        exit 0
      fi
      if ! kill -0 "${NEW_PID}" 2>/dev/null; then
        echo "错误: 服务进程异常退出，日志如下:" >&2
        cat "${LOG_FILE}" >&2
        rm -f "${PID_FILE}"
        exit 1
      fi
      sleep 0.2
    done
    echo "错误: 服务启动超时，日志如下:" >&2
    cat "${LOG_FILE}" >&2
    rm -f "${PID_FILE}"
    exit 1
    ;;
  stop)
    SP="$(saved_pid)"
    if [ -z "${SP}" ]; then
      echo "无记录中的站点进程"
      LISTENERS="$(port_pids)"
      if [ -n "${LISTENERS}" ]; then
        echo "警告: 端口 ${PORT} 仍被 PID ${LISTENERS} 占用，未做处理" >&2
      fi
      exit 0
    fi
    if ! is_ours "${SP}"; then
      echo "错误: 记录 PID ${SP} 不属于本站点（端口 ${PORT}），拒绝终止" >&2
      exit 1
    fi
    kill "${SP}"
    for i in $(seq 1 25); do
      kill -0 "${SP}" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "${SP}" 2>/dev/null; then
      echo "错误: PID ${SP} 未能停止" >&2
      exit 1
    fi
    rm -f "${PID_FILE}"
    echo "站点已停止 (PID ${SP})"
    ;;
  restart)
    "$0" stop && "$0" start
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
