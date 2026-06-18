import { Button } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { AnimatePresence, motion } from 'motion/react';

export default function ProgressBanner({
  visible,
  text,
  canCancel,
  onCancel,
}: {
  visible: boolean;
  text: string;
  canCancel: boolean;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="progress"
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.25 }}
        >
          <span className="progress__pulse">
            <LoadingOutlined />
          </span>
          <span className="progress__text">{text || '正在发布…'}</span>
          <Button danger size="small" disabled={!canCancel} onClick={onCancel}>
            取消
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
