import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Home from '../../pages/Home';

describe('Home Page', () => {
    it('renders welcome message initially', () => {
        render(
            <BrowserRouter>
                <Home />
            </BrowserRouter>
        );

        expect(screen.getByText('Welcome')).toBeInTheDocument();
    });

    it('quote box is clickable', () => {
        render(
            <BrowserRouter>
                <Home />
            </BrowserRouter>
        );

        const quoteBox = screen.getByText('Welcome');
        expect(quoteBox).toBeInTheDocument();

        fireEvent.click(quoteBox);
        // Click should not throw - component remains rendered
        expect(quoteBox.closest('div')).toBeInTheDocument();
    });
});
