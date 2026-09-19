import styles from './UserAvatar.module.css';

type UserAvatarProps = {
  username: string;
  hasAvatar: boolean;
  /** Rendered size in pixels. */
  size?: number;
};

/**
 * Round avatar with the stored profile picture, falling back to the first
 * initial on a neutral circle.
 */
const UserAvatar = ({ username, hasAvatar, size = 24 }: UserAvatarProps) => {
  if (hasAvatar) {
    return (
      <img
        className={styles.avatar}
        style={{ width: size, height: size }}
        src={`${process.env.REACT_APP_API_URL}/users/${username}/avatar`}
        alt={`${username}'s avatar`}
      />
    );
  }

  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden="true"
    >
      {username[0]?.toLocaleUpperCase()}
    </span>
  );
};

export default UserAvatar;
