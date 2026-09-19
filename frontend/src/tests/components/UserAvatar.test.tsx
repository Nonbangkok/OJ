import { render, screen } from '@testing-library/react';
import UserAvatar from '../../components/user/UserAvatar';

describe('UserAvatar', () => {
    it('renders an image when the user has an avatar', () => {
        render(<UserAvatar username="tester" hasAvatar size={24} />);
        const img = screen.getByAltText("tester's avatar");
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toContain('/users/tester/avatar');
    });

    it('renders the first initial when there is no avatar', () => {
        render(<UserAvatar username="tester" hasAvatar={false} size={24} />);
        expect(screen.getByText('T')).toBeInTheDocument();
        expect(screen.queryByAltText("tester's avatar")).not.toBeInTheDocument();
    });
});
