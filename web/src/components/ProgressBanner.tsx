import { Button } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { AnimatePresence, motion } from 'motion/react';

export default function ProgressBanner({
  visible,
  text,
  onCancel,
}: {
  visible: boolean;
  text: string;
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
          {/* The banner only exists while publishing, so cancelling is always
              available here — a separate canCancel flag was always true. */}
          <Button danger size="small" onClick={onCancel}>
            取消
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
